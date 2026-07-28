// #367: guard-тест «ядро ralph без проектной специфики». Цель переносимости (#204) —
// перенести автономный раннер в другой репозиторий = скопировать `.claude/ralph/` +
// `scripts/` и заполнить ОДИН конфиг, без правок кода. Значит проектные строки (имя репо,
// владельца доски, домен прода, фичи вроде game-next) живут ТОЛЬКО в `ralph.config.json`
// и в поясняющих комментариях-примерах — но не в исполняемом коде ядра. Этот тест
// вмораживает границу: вернётся специфика в код — сьют покраснеет, а не «однажды заметим».
//
// Барьер, а не абзац в промпт (инвариант №5): grep как часть сьюта ловит регресс
// детерминированно, независимо от внимательности ревьюера.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// `__dirname` (не import.meta): tsconfig ралфа компилит в CommonJS-режиме nodenext, где
// import.meta запрещён (TS1470). Отсчёт от файла, а не от cwd, — устойчив к месту запуска.
const REPO_ROOT = resolve(__dirname, '../..'); // .claude/ralph → корень репозитория

// Проектная специфика pixel-tanks: имя репозитория/домена, владелец доски, фича game-next
// (#204 замерял именно этот набор). Одинаковый паттерн для юнит-проверок стриппера и для
// живого скана — единственный источник правды, чтобы они не разъехались.
const SPECIFICS = /pixel-tanks|pixeltanks|AtlantaTeam|game-next/;

const CODE_EXT = /\.(js|ts|mjs)$/;
// Из скана исключаем: тесты (сами держат паттерн в проверках), общую тест-инфру
// предохранителя #138 и `test-helpers`. Фикстуры и данные (.json/.log/.md/.sh) — не код.
const EXCLUDE = /\.test\.(js|ts|mjs)$|^test-setup\.js$|^test-helpers\.(js|mjs)$/;

// Модули ядра одного уровня директории (без рекурсии): в `.claude/ralph/` подпапка
// `provision/` — специфика VDS-в-РФ (bash + README), в другом окружении просто
// выключается и к переносимости кода отношения не имеет. `ralph.config.json` — это
// ИМЕННО место, где проектные строки жить обязаны, поэтому в скан не попадает (JSON, не код).
function coreFiles(relDir: string): string[] {
    return readdirSync(join(REPO_ROOT, relDir), { withFileTypes: true })
        .filter((e) => e.isFile() && CODE_EXT.test(e.name) && !EXCLUDE.test(e.name))
        .map((e) => join(relDir, e.name))
        .sort();
}

const CORE = [...coreFiles('.claude/ralph'), ...coreFiles('scripts')];

// Убираем комментарии, чтобы отличить проектную строку в КОДЕ (нарушение переносимости)
// от поясняющего комментария-примера («был 'AtlantaTeam'/1» — это норма и часть истории).
// Блочные /* … */ вырезаем целиком (в т.ч. многострочные), затем выкидываем строки-
// целиком-комментарии (`^\s*//` и `^\s**`). Хвостовые `// …` НЕ трогаем намеренно: наивный
// срез по первому `//` съел бы `//` внутри URL-строки ('https://pixeltanks.ru') в коде и
// пропустил бы реальную специфику — а именно её тест обязан ловить (false-negative хуже
// редкого false-positive на непринятом стиле «код; // pixel-tanks»).
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
}

function specificsInCode(src: string): Array<[number, string]> {
    return stripComments(src)
        .split('\n')
        .map((line, i) => [i + 1, line] as [number, string])
        .filter(([, line]) => SPECIFICS.test(line));
}

describe('stripComments — граница «код vs комментарий-пример»', () => {
    it('ловит проектную строку в исполняемом коде', () => {
        const bad = "const worktree = 'pixel-tanks-ralph';\n";
        expect(SPECIFICS.test(stripComments(bad))).toBe(true);
    });

    it('игнорирует однострочный поясняющий комментарий-пример', () => {
        const ok = "// был 'AtlantaTeam'/1, теперь из конфига\nconst owner = cfg.owner;\n";
        expect(SPECIFICS.test(stripComments(ok))).toBe(false);
    });

    it('игнорирует многострочный блочный комментарий с примером', () => {
        const ok = "/*\n * дефолт был 'pixel-tanks-ralph'\n */\nreturn base + '-ralph';\n";
        expect(SPECIFICS.test(stripComments(ok))).toBe(false);
    });

    it('НЕ съедает URL-строку в коде из-за `//` внутри неё', () => {
        // Регресс-охрана самого стриппера: домен в КОДЕ (не в конфиге) обязан ловиться,
        // несмотря на `//` внутри 'https://…'.
        const bad = "const url = 'https://pixeltanks.ru';\n";
        expect(SPECIFICS.test(stripComments(bad))).toBe(true);
    });
});

describe('набор сканируемых модулей ядра', () => {
    // Пустой it.each([]) был бы «зелёным» вхолостую — фиксируем, что скан реально видит
    // ядро, а не молча ничего (сломанный путь/фильтр).
    it('непуст и включает ключевые модули', () => {
        expect(CORE.length).toBeGreaterThan(10);
        expect(CORE).toContain(join('.claude/ralph', 'ralph.js'));
        expect(CORE).toContain(join('.claude/ralph', 'orchestrator.ts'));
        expect(CORE).toContain(join('.claude/ralph', 'monitor.js'));
        expect(CORE).toContain(join('.claude/ralph', 'telegram-notifier.js'));
        expect(CORE).toContain(join('scripts', 'project-sync.mjs'));
    });
});

describe('ядро ralph свободно от проектной специфики (#204/#367)', () => {
    it.each(CORE)('%s — без pixel-tanks/AtlantaTeam/game-next в коде', (rel) => {
        const hits = specificsInCode(readFileSync(join(REPO_ROOT, rel), 'utf-8'));
        const detail = hits.map(([n, line]) => `\n  ${n}: ${line.trim()}`).join('');
        expect(
            hits,
            `Проектная специфика в коде ${rel} — вынеси в ralph.config.json:${detail}`,
        ).toEqual([]);
    });
});
