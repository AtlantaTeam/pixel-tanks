import { describe, expect, it } from 'vitest';
import {
    SECRET_ENV_VARS,
    SECRET_FILE_CHANNELS,
    buildReport,
    expandHome,
    formatReport,
    redact,
    scanEnvChannels,
    scanFileChannels,
} from './secret-canary.mjs';

// #184: канареечная проверка границы изоляции. Тесты гоняют ЛОГИКУ детекта на
// ИНЖЕКТИРОВАННЫХ фикстурах (фейковый env, фейковый readFileFn) — они никогда не читают
// настоящие process.env / файлы, поэтому в гейте зелёные и не утаскивают реальный секрет
// (сам живой скан — ручной скрипт main(), в гейт на этой фазе не встраивается, см.
// docs/ralph-isolation/plan.md фаза 3 и уточнение по ревью в #184).

// Ошибка чтения с кодом — как её бросает fs.readFileSync (ENOENT/EACCES).
function fsError(code) {
    const e = new Error(`${code}: fake`);
    e.code = code;
    return e;
}

describe('redact — значение секрета не утекает в отчёт (#184)', () => {
    it('для пустого/отсутствующего значения возвращает <пусто>', () => {
        expect(redact('')).toBe('<пусто>');
        expect(redact(undefined)).toBe('<пусто>');
        expect(redact(null)).toBe('<пусто>');
    });

    it('НИКОГДА не печатает само значение — только факт и длину', () => {
        const secret = 'ghp_supersecretvalue1234567890';
        const out = redact(secret);
        expect(out).not.toContain(secret);
        expect(out).toContain(String(secret.length));
    });
});

describe('SECRET_ENV_VARS / SECRET_FILE_CHANNELS — покрыты каналы из критериев #184', () => {
    it('env-каналы включают три названных в issue секрета', () => {
        expect(SECRET_ENV_VARS).toContain('GH_TOKEN');
        expect(SECRET_ENV_VARS).toContain('CLAUDE_CODE_OAUTH_TOKEN');
        // TG-токен — под именем из issue и под реальным именем раннера (инвариант 11).
        expect(SECRET_ENV_VARS.some((v) => v.includes('TG_BOT_TOKEN'))).toBe(true);
    });

    it('файловые каналы включают ~/.config/gh/hosts.yml (явно назван в критерии)', () => {
        expect(SECRET_FILE_CHANNELS.some((c) => c.path === '~/.config/gh/hosts.yml')).toBe(true);
    });
});

describe('scanEnvChannels — детект секрета в окружении (#184)', () => {
    it('присутствующий непустой секрет — канал ОТКРЫТ, значение не в отчёте', () => {
        const env = { GH_TOKEN: 'ghp_liveTokenValue' };
        const res = scanEnvChannels(env, ['GH_TOKEN']);
        expect(res).toHaveLength(1);
        expect(res[0].channel).toBe('env:GH_TOKEN');
        expect(res[0].open).toBe(true);
        expect(res[0].detail).not.toContain('ghp_liveTokenValue');
    });

    it('отсутствующий секрет — канал закрыт', () => {
        const res = scanEnvChannels({}, ['GH_TOKEN']);
        expect(res[0].open).toBe(false);
        expect(res[0].detail).toBe('<пусто>');
    });

    it('пустая строка не считается открытым каналом (наличие ключа ≠ наличие секрета)', () => {
        const res = scanEnvChannels({ GH_TOKEN: '' }, ['GH_TOKEN']);
        expect(res[0].open).toBe(false);
    });
});

describe('expandHome — раскрытие ведущего ~ (#184)', () => {
    it('~ раскрывается в домашний каталог', () => {
        expect(expandHome('~', '/home/ralph')).toBe('/home/ralph');
    });

    it('~/path раскрывается относительно дома', () => {
        expect(expandHome('~/.config/gh/hosts.yml', '/home/ralph')).toBe(
            '/home/ralph/.config/gh/hosts.yml',
        );
    });

    it('абсолютный путь без ~ не трогается', () => {
        expect(expandHome('/root/ralph.env', '/home/ralph')).toBe('/root/ralph.env');
    });
});

describe('scanFileChannels — детект секрета в файлах (#184)', () => {
    const channels = [{ path: '~/.config/gh/hosts.yml', label: 'gh', markers: ['oauth_token'] }];

    it('читаемый файл с маркером секрета — канал ОТКРЫТ', () => {
        const readFileFn = () => 'github.com:\n  oauth_token: ghp_xxx\n';
        const res = scanFileChannels(readFileFn, '/home/ralph', channels);
        expect(res[0].open).toBe(true);
        expect(res[0].channel).toBe('file:~/.config/gh/hosts.yml');
        // Значение токена в отчёт не попадает — только имя маркера.
        expect(res[0].detail).not.toContain('ghp_xxx');
        expect(res[0].detail).toContain('oauth_token');
    });

    it('читаемый файл без маркеров — канал закрыт (читаемости мало, важно содержимое)', () => {
        const readFileFn = () => 'github.com:\n  user: someone\n';
        const res = scanFileChannels(readFileFn, '/home/ralph', channels);
        expect(res[0].open).toBe(false);
        expect(res[0].detail).toContain('маркеров нет');
    });

    it('файла нет (ENOENT) — канал закрыт с отметкой <нет файла>', () => {
        const readFileFn = () => {
            throw fsError('ENOENT');
        };
        const res = scanFileChannels(readFileFn, '/home/ralph', channels);
        expect(res[0].open).toBe(false);
        expect(res[0].detail).toBe('<нет файла>');
    });

    it('файл не читается по правам (EACCES) — канал закрыт, код ошибки в отчёте', () => {
        const readFileFn = () => {
            throw fsError('EACCES');
        };
        const res = scanFileChannels(readFileFn, '/home/ralph', channels);
        expect(res[0].open).toBe(false);
        expect(res[0].detail).toContain('EACCES');
    });

    it('в readFileFn уходит РАСКРЫТЫЙ путь (~ развёрнут)', () => {
        let seen = null;
        const readFileFn = (p) => {
            seen = p;
            return '';
        };
        scanFileChannels(readFileFn, '/home/ralph', channels);
        expect(seen).toBe('/home/ralph/.config/gh/hosts.yml');
    });
});

describe('buildReport / formatReport — воспроизводимый отчёт (#184)', () => {
    const deps = {
        env: { GH_TOKEN: 'live', CLAUDE_CODE_OAUTH_TOKEN: '' },
        readFileFn: () => {
            throw fsError('ENOENT');
        },
        homedir: '/home/ralph',
        secretVars: ['GH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
        fileChannels: [{ path: '~/.config/gh/hosts.yml', label: 'gh', markers: ['oauth_token'] }],
    };

    it('считает открытые каналы среди env и файлов', () => {
        const report = buildReport(deps);
        expect(report.total).toBe(3); // 2 env + 1 file
        expect(report.openCount).toBe(1); // только GH_TOKEN
    });

    it('отчёт воспроизводим: тот же вход → тот же текст', () => {
        expect(formatReport(buildReport(deps))).toBe(formatReport(buildReport(deps)));
    });

    it('текст различает открытые и закрытые каналы и не содержит значения секрета', () => {
        const text = formatReport(buildReport(deps));
        expect(text).toContain('🔓');
        expect(text).toContain('🔒');
        expect(text).not.toContain('live');
    });
});
