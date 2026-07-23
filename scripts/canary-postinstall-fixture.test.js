import { describe, expect, it } from 'vitest';
import {
    SECRET_ENV_VARS as CANARY_ENV_VARS,
    SECRET_FILE_CHANNELS as CANARY_FILE_CHANNELS,
} from './secret-canary.mjs';
import {
    SECRET_ENV_VARS,
    SECRET_FILE_CHANNELS,
    buildReport,
    expandHome,
    formatReport,
    redact,
    runProbe,
    scanEnvChannels,
    scanFileChannels,
} from './canary-postinstall-fixture/probe.mjs';

// #185: фикстура npm-зависимости с lifecycle-скриптом (postinstall). Тесты гоняют ЛОГИКУ
// детекта probe.mjs на ИНЖЕКТИРОВАННЫХ фикстурах (фейковый env, фейковый readFileFn) — они
// никогда не читают настоящие process.env / файлы, поэтому зелёные в гейте и не утаскивают
// реальный секрет. Живой скан — только postinstall.mjs при реальном `npm ci` (ручной
// демо-скрипт scripts/canary-postinstall.mjs), в гейт на этой фазе он не встраивается.

function fsError(code) {
    const e = new Error(`${code}: fake`);
    e.code = code;
    return e;
}

// БАРЬЕР против дрейфа (#185): probe.mjs НЕ импортирует secret-canary.mjs (самодостаточен —
// иначе postinstall у скопированной в node_modules зависимости упал бы на сломанном импорте
// и сломал `npm ci`). Цена — дублированные списки каналов; этот тест держит их в синхроне,
// чтобы «тот же канареечный подход» не разъехался: добавили секрет в канарейку, забыли в
// фикстуре — тест краснеет.
describe('синхронность каналов с secret-canary.mjs (#185)', () => {
    it('env-переменные совпадают с канарейкой (#184)', () => {
        expect([...SECRET_ENV_VARS].sort()).toEqual([...CANARY_ENV_VARS].sort());
    });

    it('файловые каналы (путь + маркеры) совпадают с канарейкой (#184)', () => {
        const norm = (channels) =>
            channels
                .map((c) => ({ path: c.path, markers: [...c.markers].sort() }))
                .sort((a, b) => a.path.localeCompare(b.path));
        expect(norm(SECRET_FILE_CHANNELS)).toEqual(norm(CANARY_FILE_CHANNELS));
    });
});

describe('redact — значение секрета не утекает в отчёт (#185)', () => {
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

describe('scanEnvChannels — детект секрета в окружении postinstall (#185)', () => {
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

    it('пустая строка не считается открытым каналом', () => {
        const res = scanEnvChannels({ GH_TOKEN: '' }, ['GH_TOKEN']);
        expect(res[0].open).toBe(false);
    });
});

describe('expandHome — раскрытие ведущего ~ (#185)', () => {
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

describe('scanFileChannels — детект секрета в файлах (#185)', () => {
    const channels = [{ path: '~/.config/gh/hosts.yml', label: 'gh', markers: ['oauth_token'] }];

    it('читаемый файл с маркером секрета — канал ОТКРЫТ, значение не в отчёте', () => {
        const readFileFn = () => 'github.com:\n  oauth_token: ghp_xxx\n';
        const res = scanFileChannels(readFileFn, '/home/ralph', channels);
        expect(res[0].open).toBe(true);
        expect(res[0].channel).toBe('file:~/.config/gh/hosts.yml');
        expect(res[0].detail).not.toContain('ghp_xxx');
        expect(res[0].detail).toContain('oauth_token');
    });

    it('читаемый файл без маркеров — канал закрыт', () => {
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

describe('buildReport / formatReport / runProbe — воспроизводимый отчёт (#185)', () => {
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

    it('отчёт воспроизводим и помечен как postinstall', () => {
        const text = formatReport(buildReport(deps));
        expect(text).toBe(formatReport(buildReport(deps)));
        expect(text).toContain('Postinstall');
    });

    it('текст различает открытые и закрытые каналы и не содержит значения секрета', () => {
        const text = formatReport(buildReport(deps));
        expect(text).toContain('🔓');
        expect(text).toContain('🔒');
        expect(text).not.toContain('live');
    });

    it('runProbe принимает инжектируемые env/readFileFn/homedir (без чтения реальных секретов)', () => {
        const report = runProbe({
            env: { GH_TOKEN: 'live' },
            readFileFn: () => {
                throw fsError('ENOENT');
            },
            homedir: '/home/ralph',
        });
        expect(report.openCount).toBe(1);
        expect(report.channels.every((c) => !c.detail.includes('live'))).toBe(true);
    });
});
