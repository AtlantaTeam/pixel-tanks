import { describe, expect, it } from 'vitest';
import {
    SECRET_ENV_VARS as CANARY_ENV_VARS,
    SECRET_FILE_CHANNELS as CANARY_FILE_CHANNELS,
    buildReport as canaryBuildReport,
    formatReport as canaryFormatReport,
} from './secret-canary.mjs';
import {
    SECRET_ENV_VARS,
    SECRET_FILE_CHANNELS,
    buildReport,
    formatReport,
    runProbe,
} from './canary-postinstall-fixture/probe.mjs';

// #185: фикстура npm-зависимости с lifecycle-скриптом (postinstall). Тесты гоняют ЛОГИКУ
// детекта probe.mjs на ИНЖЕКТИРОВАННЫХ фикстурах (фейковый env, фейковый readFileFn) — они
// никогда не читают настоящие process.env / файлы, поэтому зелёные в гейте и не утаскивают
// реальный секрет. Живой скан — только postinstall.mjs при реальном `npm ci` (ручной
// демо-скрипт scripts/canary-postinstall.mjs), в гейт на этой фазе он не встраивается.
//
// probe.mjs НЕ импортирует secret-canary.mjs (самодостаточен — иначе postinstall у
// скопированной в node_modules зависимости упал бы на сломанном импорте и сломал `npm ci`),
// поэтому ВСЯ логика детекта в нём — копия канарейки. Дублировать сюда ещё и юнит-тесты
// каждой функции (redact/expandHome/scanEnvChannels/scanFileChannels) смысла нет: их
// поведение фиксирует secret-canary.test.js, а идентичность копии — барьеры ниже. Здесь
// остаётся ТОЛЬКО специфика фикстуры (postinstall-заголовок, runProbe) плюс барьеры дрейфа.

function fsError(code) {
    const e = new Error(`${code}: fake`);
    e.code = code;
    return e;
}

// БАРЬЕР против дрейфа (#185): probe.mjs — самодостаточная копия канарейки. Два барьера
// держат её в синхроне: (1) ДАННЫЕ — списки каналов совпадают; (2) ЛОГИКА — buildReport
// обоих модулей даёт одинаковый отчёт на одном входе. Только (1) мало: списки могли бы
// совпасть, а детект (redact/expandHome/scan*/формат detail) — разъехаться, и барьер
// остался бы зелёным. Поэтому нужна и поведенческая сверка.
describe('синхронность каналов с secret-canary.mjs — ДАННЫЕ (#185)', () => {
    it('env-переменные совпадают с канарейкой (#184)', () => {
        expect([...SECRET_ENV_VARS].sort()).toEqual([...CANARY_ENV_VARS].sort());
    });

    it('файловые каналы (путь + подпись + маркеры) совпадают с канарейкой (#184)', () => {
        // label сверяем наравне с path/markers: он попадает в отчёт (formatReport), и его
        // дрейф нарушил бы «тот же канареечный подход» так же, как дрейф маркеров.
        const norm = (channels) =>
            channels
                .map((c) => ({ path: c.path, label: c.label, markers: [...c.markers].sort() }))
                .sort((a, b) => a.path.localeCompare(b.path));
        expect(norm(SECRET_FILE_CHANNELS)).toEqual(norm(CANARY_FILE_CHANNELS));
    });
});

describe('синхронность логики с secret-canary.mjs — ПОВЕДЕНИЕ (#185)', () => {
    // Один инжектированный вход, покрывающий все ветки детекта: env открытый/пустой/непустой,
    // файл с маркером, файл без маркеров, ENOENT, ошибка чтения без code. Прогоняем через
    // buildReport обоих модулей и сверяем результат — так дрейф ЛЮБОЙ функции (не только
    // списков) краснит тест.
    const deps = {
        env: { GH_TOKEN: 'live', GITHUB_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: 'x' },
        homedir: '/home/ralph',
        readFileFn: (p) => {
            if (p === '/home/ralph/.config/gh/hosts.yml')
                return 'github.com:\n  oauth_token: ghp_x\n';
            if (p === '/home/ralph/.claude/.credentials.json') return '{"user":"x"}'; // без маркеров
            if (p === '/root/ralph.env') throw fsError('ENOENT');
            throw new Error('boom'); // ветка без .code
        },
        secretVars: ['GH_TOKEN', 'GITHUB_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
        fileChannels: [
            { path: '~/.config/gh/hosts.yml', label: 'gh', markers: ['oauth_token'] },
            { path: '~/.claude/.credentials.json', label: 'claude', markers: ['accessToken'] },
            { path: '/root/ralph.env', label: 'env', markers: ['GH_TOKEN'] },
            { path: '/weird', label: 'weird', markers: ['x'] },
        ],
    };
    // Отчёты различаются только первой строкой-заголовком («Postinstall-канарейка…» vs
    // «Канарейка секретов…») — это ожидаемо; сверяем тело.
    const body = (text) => text.split('\n').slice(1).join('\n');

    it('buildReport даёт идентичные каналы (channel/open/detail) на одном входе', () => {
        expect(buildReport(deps).channels).toEqual(canaryBuildReport(deps).channels);
    });

    it('formatReport (без строки-заголовка) совпадает с канарейкой', () => {
        expect(body(formatReport(buildReport(deps)))).toBe(
            body(canaryFormatReport(canaryBuildReport(deps))),
        );
    });
});

describe('специфика фикстуры: postinstall-отчёт и runProbe (#185)', () => {
    const deps = {
        env: { GH_TOKEN: 'live', CLAUDE_CODE_OAUTH_TOKEN: '' },
        readFileFn: () => {
            throw fsError('ENOENT');
        },
        homedir: '/home/ralph',
        secretVars: ['GH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
        fileChannels: [{ path: '~/.config/gh/hosts.yml', label: 'gh', markers: ['oauth_token'] }],
    };

    it('заголовок отчёта помечен как postinstall (отличим от обычной канарейки)', () => {
        expect(formatReport(buildReport(deps))).toContain('Postinstall');
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
