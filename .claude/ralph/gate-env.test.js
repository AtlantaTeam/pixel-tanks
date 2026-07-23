import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
    DEFAULT_ALLOWLIST_PATH,
    normalizeAllowlist,
    loadGateEnvAllowlist,
    isAllowed,
    sanitizeEnv,
    buildSanitizedGateEnv,
} from './gate-env.js';

// #188: allowlist-санация env чеков гейта. Тесты гоняют чистые функции на ФИКСТУРАХ
// (фейковый env, инжектированный readFileFn) — настоящие process.env/файлы не читаются,
// поэтому в гейте зелёные и секрет не утаскивают.

// Ошибка чтения с кодом — как её бросает fs.readFileSync (ENOENT/EACCES).
function fsError(code) {
    const e = new Error(`${code}: fake`);
    e.code = code;
    return e;
}

const SIMPLE = { exact: ['PATH', 'HOME'], prefixes: ['LC_'] };

describe('normalizeAllowlist — валидация формы (#188)', () => {
    it('превращает массивы в { exact:Set, prefixes:[] }', () => {
        const a = normalizeAllowlist(SIMPLE);
        expect(a.exact.has('PATH')).toBe(true);
        expect(a.exact.has('HOME')).toBe(true);
        expect(a.prefixes).toEqual(['LC_']);
    });

    it('игнорирует необязательные поля (note)', () => {
        const a = normalizeAllowlist({ note: 'зачем', exact: ['PATH'], prefixes: [] });
        expect(a.exact.has('PATH')).toBe(true);
        expect(a.prefixes).toEqual([]);
    });

    it('fail-closed: не объект', () => {
        expect(() => normalizeAllowlist(null)).toThrow();
        expect(() => normalizeAllowlist([])).toThrow();
        expect(() => normalizeAllowlist('строка')).toThrow();
    });

    it('fail-closed: exact/prefixes не массивы', () => {
        expect(() => normalizeAllowlist({ exact: 'PATH', prefixes: [] })).toThrow();
        expect(() => normalizeAllowlist({ exact: [], prefixes: {} })).toThrow();
    });

    it('fail-closed: пустые/нестроковые записи', () => {
        expect(() => normalizeAllowlist({ exact: [''], prefixes: [] })).toThrow();
        expect(() => normalizeAllowlist({ exact: [123], prefixes: [] })).toThrow();
        expect(() => normalizeAllowlist({ exact: [], prefixes: [null] })).toThrow();
    });
});

describe('isAllowed — точное имя и префикс (#188)', () => {
    const a = normalizeAllowlist(SIMPLE);

    it('пропускает точное совпадение', () => {
        expect(isAllowed('PATH', a)).toBe(true);
        expect(isAllowed('HOME', a)).toBe(true);
    });

    it('пропускает совпадение по префиксу', () => {
        expect(isAllowed('LC_ALL', a)).toBe(true);
        expect(isAllowed('LC_CTYPE', a)).toBe(true);
    });

    it('НЕ пропускает то, чего нет в allowlist', () => {
        expect(isAllowed('GH_TOKEN', a)).toBe(false);
        expect(isAllowed('RANDOM_NEW_VAR', a)).toBe(false);
    });

    it('точное совпадение чувствительно к регистру и не срабатывает на подстроке', () => {
        expect(isAllowed('path', a)).toBe(false);
        expect(isAllowed('MYPATH', a)).toBe(false);
    });
});

describe('sanitizeEnv — allowlist, а не blocklist (#188)', () => {
    const a = normalizeAllowlist({
        exact: ['PATH', 'HOME', 'CI'],
        prefixes: ['LC_'],
    });

    it('оставляет разрешённые, выкидывает всё прочее', () => {
        const out = sanitizeEnv(
            { PATH: '/usr/bin', HOME: '/root', LC_ALL: 'C', GH_TOKEN: 'ghp_x', FOO: 'bar' },
            a,
        );
        expect(out.PATH).toBe('/usr/bin');
        expect(out.HOME).toBe('/root');
        expect(out.LC_ALL).toBe('C');
        expect('GH_TOKEN' in out).toBe(false);
        expect('FOO' in out).toBe(false);
    });

    // Ключевой критерий готовности #188: НОВАЯ переменная в env, которой нет в allowlist,
    // до чеков не доходит — по умолчанию отсекается, а не молча наследуется.
    it('новая переменная без записи в allowlist отсекается по умолчанию', () => {
        const out = sanitizeEnv({ PATH: '/usr/bin', TOTALLY_NEW_SECRET: 'leak' }, a);
        expect('TOTALLY_NEW_SECRET' in out).toBe(false);
        expect(out.PATH).toBe('/usr/bin');
    });

    it('не мутирует исходный env', () => {
        const src = { PATH: '/usr/bin', GH_TOKEN: 'ghp_x' };
        sanitizeEnv(src, a);
        expect(src.GH_TOKEN).toBe('ghp_x');
    });

    it('не отравляется именем __proto__ во входном env', () => {
        const out = sanitizeEnv({ PATH: '/usr/bin', __proto__: { polluted: true } }, a);
        expect(out.PATH).toBe('/usr/bin');
        expect({}.polluted).toBeUndefined();
    });
});

describe('loadGateEnvAllowlist — загрузка из файла (#188)', () => {
    it('парсит и нормализует валидный JSON', () => {
        const readFileFn = () => JSON.stringify(SIMPLE);
        const a = loadGateEnvAllowlist('/fake/path.json', readFileFn);
        expect(a.exact.has('PATH')).toBe(true);
        expect(a.prefixes).toEqual(['LC_']);
    });

    it('fail-closed: файл не читается', () => {
        const readFileFn = () => {
            throw fsError('ENOENT');
        };
        expect(() => loadGateEnvAllowlist('/nope.json', readFileFn)).toThrow(/не читается/);
    });

    it('fail-closed: не валидный JSON', () => {
        const readFileFn = () => '{ битый';
        expect(() => loadGateEnvAllowlist('/broken.json', readFileFn)).toThrow(/не парсится/);
    });
});

describe('buildSanitizedGateEnv — обёртка загрузка+санация (#188)', () => {
    it('загружает allowlist и санирует переданный env', () => {
        const readFileFn = () => JSON.stringify({ exact: ['PATH'], prefixes: [] });
        const out = buildSanitizedGateEnv({
            env: { PATH: '/usr/bin', GH_TOKEN: 'ghp_x' },
            allowlistPath: '/fake.json',
            readFileFn,
        });
        expect(out.PATH).toBe('/usr/bin');
        expect('GH_TOKEN' in out).toBe(false);
    });
});

// Реальный файл allowlist репозитория — источник санации в проде: если он битый или
// отрезает то, без чего чеки не запустятся (PATH/HOME), гейт краснел бы инфраструктурой.
describe('gate-env-allowlist.json репозитория (#188)', () => {
    it('парсится, содержит базовые переменные окружения чеков', () => {
        const a = loadGateEnvAllowlist(DEFAULT_ALLOWLIST_PATH, fs.readFileSync);
        expect(a.exact.has('PATH')).toBe(true);
        expect(a.exact.has('HOME')).toBe(true);
    });

    // Список — именно allowlist: секретов петли в нём нет, значит санация их отрежет.
    it('НЕ содержит секретов петли', () => {
        const a = loadGateEnvAllowlist(DEFAULT_ALLOWLIST_PATH, fs.readFileSync);
        for (const secret of [
            'GH_TOKEN',
            'GITHUB_TOKEN',
            'CLAUDE_CODE_OAUTH_TOKEN',
            'ANTHROPIC_API_KEY',
            'RALPH_TG_BOT_TOKEN',
            'TG_BOT_TOKEN',
        ]) {
            expect(isAllowed(secret, a)).toBe(false);
        }
    });
});
