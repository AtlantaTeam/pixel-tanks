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
const REPO_ROOT = resolve(__dirname, '../../..'); // .claude/ralph/tests → корень репозитория

// Проектная специфика pixel-tanks: имя репозитория/домена, владелец доски, фича game-next
// (#204 замерял именно этот набор). Одинаковый паттерн для юнит-проверок стриппера и для
// живого скана — единственный источник правды, чтобы они не разъехались.
const SPECIFICS = /pixel-tanks|pixeltanks|AtlantaTeam|game-next/;

const CODE_EXT = /\.(js|ts|mjs|mts)$/;
// Из скана исключаем: тесты (сами держат паттерн в проверках), общую тест-инфру
// предохранителя #138 и `test-helpers`. Сканируем только код ядра (CODE_EXT = js/ts/mjs/mts —
// .mts у явно-ESM модулей ядра: gate-env.mts (#403) и runtime/monitor-panel.mts (#404)).
// .json/.log/.md — данные/конфиг/доки. .sh (deploy-remote.sh/backup-db.sh) НЕ сканируем не
// потому что «не код» — это исполняемые скрипты с проектной специфики (домен, VDS), — а
// потому что это деплой-обвязка ВНЕ переносимого ядра раннера: при переносе она заменяется
// под своё окружение, а не копируется как есть (#367-ревью).
// test-setup/test-helpers переведены в .ts (#405), поэтому и в EXCLUDE — `.ts`. Отсечение
// это «защита на будущее»: сейчас оба файла лежат в `tests/` (SKIP_DIRS) и до имени скан не
// доходит, но появись такой файл вне tests/ — он всё равно выпадет из скана.
const EXCLUDE = /\.test\.(js|ts|mjs|mts)$|^test-setup\.ts$|^test-helpers\.ts$/;

// После раскладки по папкам (#396) модули ядра лежат в подпапках `.claude/ralph/`
// (core/adapters/shared/runtime) + два файла в корне (ralph.js, gate-env.mts). Обход стал
// РЕКУРСИВНЫМ — иначе `coreFiles('.claude/ralph')` вернул бы только пару корневых файлов,
// а весь ядровый код в подпапках выпал бы из скана: grep-guard остался бы зелёным, ничего
// не проверяя (тот же класс, что `looksBlind` в security-audit.mjs). Пропускаем каталоги:
// `provision/` (специфика VDS-в-РФ, при переносе заменяется), `tests/` (сам держит паттерн
// в проверках, а `__fixtures__/` под ним ОБЯЗАНА нести чужую специфику), `node_modules/`.
// `__fixtures__` в наборе — защита НА БУДУЩЕЕ: сейчас единственный такой каталог лежит внутри
// `tests/` и отсекается раньше (до вложенной проверки рекурсия не доходит), но появись
// `__fixtures__` в другом месте — он всё равно выпадет из скана. `ralph.config.json` — ИМЕННО
// место, где проектные строки жить обязаны, поэтому в скан не попадает (JSON, не код).
const SKIP_DIRS = new Set(['provision', 'tests', '__fixtures__', 'node_modules']);

function coreFiles(relDir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(join(REPO_ROOT, relDir), { withFileTypes: true })) {
        const rel = join(relDir, e.name);
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            out.push(...coreFiles(rel));
        } else if (e.isFile() && CODE_EXT.test(e.name) && !EXCLUDE.test(e.name)) {
            out.push(rel);
        }
    }
    return out.sort();
}

const CORE = [...coreFiles('.claude/ralph'), ...coreFiles('scripts')];

// Вырезание блочных комментариев /* … */ ПОСИМВОЛЬНО, с учётом строковых литералов
// (#367-ревью). Наивный regex `/\/\*[\s\S]*?\*\//` не знает про строки: глоб-строка в коде
// ('src/**/*.ts' содержит и `/*`, и `*/`) заставила бы его вырезать кусок строки, а при
// двух таких литералах на разных строках — ВСЁ между ними, включая реальную специфику, и
// тест бы промолчал (латентный false-negative барьера). Сканер идёт по символам: внутри
// строкового литерала ('…' / "…" / `…`) маркеры комментариев НЕ маркеры (копируем как есть,
// так специфика в СТРОКЕ кода по-прежнему ловится); блочный /* … */ вне строк вырезаем
// целиком (в т.ч. многострочный); строчный // … оставляем нетронутым (его уберёт построчный
// фильтр ниже, если строка — комментарий целиком). Хвостовые `// …` не трогаем намеренно:
// наивный срез по первому `//` съел бы `//` внутри URL-строки ('https://pixeltanks.ru') и
// пропустил бы реальную специфику (false-negative хуже редкого false-positive на стиле
// «код; // pixel-tanks»). Регэкспы литералов сканер не парсит — за рамками ревью и не хуже
// прежнего regex-подхода.
function stripBlockComments(src: string): string {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        // Строковый литерал — копируем целиком, экранирование учитываем, маркеры внутри
        // комментариями не считаем.
        if (c === "'" || c === '"' || c === '`') {
            out += c;
            i++;
            while (i < n) {
                if (src[i] === '\\') {
                    out += src[i] + (src[i + 1] ?? '');
                    i += 2;
                    continue;
                }
                out += src[i];
                if (src[i] === c) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        // Строчный комментарий // … — оставляем как есть до конца строки (построчный фильтр
        // ниже уберёт строки-целиком-комментарии; хвостовые сохраняются осознанно).
        if (c === '/' && c2 === '/') {
            while (i < n && src[i] !== '\n') {
                out += src[i];
                i++;
            }
            continue;
        }
        // Блочный комментарий /* … */ — вырезаем целиком (в т.ч. многострочный).
        if (c === '/' && c2 === '*') {
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2; // пропускаем закрывающие */
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

// Убираем комментарии, чтобы отличить проектную строку в КОДЕ (нарушение переносимости)
// от поясняющего комментария-примера («был 'AtlantaTeam'/1» — это норма и часть истории).
// Блочные /* … */ вырезает stripBlockComments (с учётом строк), затем выкидываем строки-
// целиком-комментарии (`^\s*//`, `^\s*\*` — продолжение блочного, `^\s*/\*`).
function stripComments(src: string): string {
    return stripBlockComments(src)
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

    it('#367-ревью: глоб-строка с `/*` и `*/` не сбивает вырезание блочных комментариев', () => {
        // Строка-глоб содержит и `/*`, и `*/` — наивный regex вырезал бы её кусок, а при
        // двух таких литералах — всё между ними. Сканер видит их как СТРОКУ, не комментарий:
        // специфика в реальном коде между глоб-строками обязана уцелеть и пойматься.
        const src =
            "const glob = 'src/**/*.ts';\nconst repo = 'pixel-tanks';\nconst g2 = 'lib/**/*.js';\n";
        expect(SPECIFICS.test(stripComments(src))).toBe(true);
    });

    it('#367-ревью: специфика ВНУТРИ строкового литерала ловится (строка = код)', () => {
        const bad = "const owner = 'AtlantaTeam';\n";
        expect(SPECIFICS.test(stripComments(bad))).toBe(true);
    });
});

describe('набор сканируемых модулей ядра', () => {
    // Fail-closed страж набора (#396): после раскладки по папкам рекурсивный обход обязан
    // видеть КАЖДЫЙ модуль ядра в своей подпапке. Пустой/усохший CORE = красный, а не
    // «нечего проверять»: если рекурсия сломается или каталог переименуют, модуль выпадет
    // из скана и этот список его недосчитается. Перечислены все 20 файлов ядра: 18 TS-модулей
    // (10 core + 2 adapters + 2 shared + 3 runtime + ESM-gate-env.mts; runtime включает
    // ESM-monitor-panel.mts, #404) + 2 JS (рантайм-entry monitor.js, entry-ralph.js).
    const EXPECTED = [
        // core/
        'core/orchestrator.ts',
        'core/gate.ts',
        'core/review.ts',
        'core/deploy-check.ts',
        'core/api-limit.ts',
        'core/state-lock.ts',
        'core/worktree.ts',
        'core/exec.ts',
        'core/tunnel-check.ts',
        'core/config-profile.ts',
        // adapters/
        'adapters/adapters.ts',
        'adapters/adapters-impl.ts',
        // shared/
        'shared/ralph-util.ts',
        'shared/side-effect-guard.ts',
        // runtime/
        'runtime/monitor.js',
        'runtime/monitor-panel.mts',
        'runtime/deadman.ts',
        'runtime/telegram-notifier.ts',
        // корень раннера
        'ralph.js',
        'gate-env.mts',
    ].map((rel) => join('.claude/ralph', rel));

    it('непуст и включает КАЖДЫЙ ожидаемый модуль ядра', () => {
        // Явный `EXPECTED` строго сильнее прежнего `CORE.length > 10`: если каждый из 20
        // ожидаемых модулей в наборе — набор заведомо непуст. Один источник правды об
        // инварианте (#398-ревью), без параллельной проверки длины.
        for (const mod of EXPECTED) {
            expect(CORE, `модуль ${mod} выпал из скана core-purity`).toContain(mod);
        }
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
