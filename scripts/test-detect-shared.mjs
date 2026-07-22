#!/usr/bin/env node

// Общая механика трёх gate-скриптов сбора/детекта по тест-дереву: test-count.mjs (#154,
// храповик числа), test-only-detect.mjs (#160, .only) и test-skip-detect.mjs (#161, .skip).
// Раньше `collectVitestList`, набор глобов, разбор `git grep` и паттерн маркера дублировались
// между ними — любое исправление (например прокидка stderr) превращалось в тройную правку
// (ревью PR #230, находки о дублировании). Собрано сюда, оба-три скрипта импортируют.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Глобы тест-файлов проекта (app + ralph) — те же пути, которыми vitest.config.ts
// перечисляет тесты. Массив уходит ТОЛЬКО в `git grep` как pathspec.
//
// Префикс `:(glob)` — magic pathspec git'а, и он ОБЯЗАТЕЛЕН (ревью PR #230, 🔴 blocker):
// по умолчанию git матчит pathspec стандартным fnmatch'ем, где `**` — это просто «два `*`»,
// а слэши между сегментами обязаны присутствовать буквально. Тогда `scripts/**/*.test.js`
// требует минимум двух `/` после `scripts/` и НЕ находит `scripts/foo.test.js` — файл
// верхнего уровня каталога. Для test-skip-detect, где `git grep` — единственный источник
// решения red/green, это была дыра в самой гарантии чека (реальный `it.skip` в
// `scripts/x.test.js` проходил зелёным). С `:(glob)` git включает полноценный glob, где
// `**` = «ноль и более сегментов пути» — ровно семантика vitest (picomatch).
export const TEST_FILE_GLOBS = [
    ':(glob)src/**/*.test.ts',
    ':(glob)src/**/*.test.tsx',
    ':(glob).claude/ralph/**/*.test.js',
    ':(glob).claude/ralph/**/*.test.ts',
    ':(glob)*.config.test.ts',
    ':(glob)scripts/**/*.test.js',
    ':(glob)scripts/**/*.test.ts',
];

// Паттерн `git grep -E` для маркера (`only`/`skip`): каноничная форма `it.<marker>(` /
// `test.<marker>(` / `describe.<marker>(`, включая модификаторные цепочки ДО маркера
// (`it.concurrent.only(`) И ПОСЛЕ него (`it.skip.each([...])('...')` — документированная
// vitest-форма скипа параметризованных тестов). Хвост цепочки после маркера — `(\.[A-Za-z]+)*`
// вторым разом (ревью PR #230, 🔴 blocker): без него маркер обязан стоять последним перед
// скобкой, и `it.skip.each(` (после `.skip` идёт `.each`, а не `(`) проходил гейт ЗЕЛЁНЫМ,
// хотя тесты реально выключены. Для skip-детекта grep — единственный источник решения
// red/green, так что это была та же дыра класса «зелёный при ослабшей проверке», что и
// pathspec-слепота. `.each` активно используется в репо (ralph.test.js, bot-messages,
// game-engine) — форма не экзотическая. При этом `it.each(` без маркера по-прежнему НЕ
// матчится: `\.${marker}` требует буквального `.skip`/`.only` в цепочке.
//
// Заякорен на начало строки после отступа (`^[[:space:]]*`): реальный вызов в тест-файле
// всегда стоит с отступа, а упоминания маркера в строковых литералах (`snippet: "it.skip(..."`)
// и комментариях (`// не пиши it.only`) — нет. Якорь отсекает ложные совпадения по тексту,
// оставляя совпадения по коду — без него фикстуры этих же тест-файлов красили бы гейт
// (ревью PR #230, 🟠 major). Переименованные импорты (`import { it as t }`) не ловятся —
// редкий для проекта случай, ESLint/конвенции не поощряют алиасы; на решение red/green
// .only это не влияет (там grep — лишь подсказка).
export function grepMarkerPattern(marker) {
    return `^[[:space:]]*(it|test|describe)(\\.[A-Za-z]+)*\\.${marker}(\\.[A-Za-z]+)*[[:space:]]*\\(`;
}

// Разбор вывода `git grep -n` (`file:line:content`) в { file, line, snippet }. Строку без
// двух разделителей `:` отбрасываем явно (ревью PR #230, nit): на выходе `git grep -n`
// такого не бывает, но молчаливый разбор `indexOf === -1` дал бы мусорные { file, line }.
export function parseGrepOutput(stdout) {
    return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const sepIdx = line.indexOf(':');
            if (sepIdx === -1) return null;
            const rest = line.slice(sepIdx + 1);
            const lineSepIdx = rest.indexOf(':');
            if (lineSepIdx === -1) return null;
            return {
                file: line.slice(0, sepIdx),
                line: rest.slice(0, lineSepIdx),
                snippet: rest.slice(lineSepIdx + 1).trim(),
            };
        })
        .filter(Boolean);
}

// mkdtempSync — каталог 0700 со случайным суффиксом. Предсказуемое имя в общем /tmp
// (pid+таймштамп угадываются) — классическая поверхность для symlink-подмены: vitest
// перезаписал бы то, куда указывает подложенная ссылка. Приватный каталог дешевле спора
// о модели угроз (подробнее — исходный докблок test-count.mjs #154).
export function defaultOutputFile(prefix) {
    return path.join(mkdtempSync(path.join(os.tmpdir(), prefix)), 'vitest-list.json');
}

// `vitest list` (СБОР тест-кейсов без прогона) с --no-isolate (~6с вместо ~20с; изоляция
// не нужна ради перечня it()) и --no-install (без похода в сеть за пакетом — тот же класс,
// что красил build #206). Отчёт пишется в --json=<file> (чистый канал, не смешанный stdout).
// Возвращает { report, status, stderr }: report — распарсенный список; status — код спавна
// (у test-count безразличен, у only-detect авторитетен для .only); stderr — для диагностики
// на стороне вызывающего (ревью PR #230, minor: ненулевой код бывает и не из-за .only).
//
// Fail-closed: файл не появился (сбой самого сбора) или JSON битый — throw, не «пропустим».
export function collectVitestList({
    spawnFn = spawnSync,
    outputFile,
    extraArgs = [],
    tmpPrefix,
} = {}) {
    const result = spawnFn(
        'npx',
        ['--no-install', 'vitest', 'list', '--no-isolate', ...extraArgs, `--json=${outputFile}`],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );

    let raw;
    try {
        raw = readFileSync(outputFile, 'utf8');
    } catch (e) {
        // При реальном сбое сбора (синтаксис в тест-файле, упавший конфиг) vitest пишет
        // причину в stderr — без неё чини-сессия видела бы только ENOENT (класс, чинённый
        // в security-audit.mjs по ревью #141).
        const why =
            result?.error?.message ||
            (typeof result?.status === 'number'
                ? `код выхода ${result.status}`
                : 'причина неизвестна');
        const stderrTail = (result?.stderr || '').trim().slice(-2000);
        throw new Error(
            `vitest не записал список тестов (${outputFile}) — сбой сбора: ${e.message}; ` +
                `${why}${stderrTail ? `; stderr: ${stderrTail}` : ''}`,
        );
    } finally {
        // Убираем и файл, и созданный под него временный каталог (mkdtemp). Каталог сносим
        // только если это наш temp (tmpPrefix-*), чтобы переданный через DI путь не задеть.
        try {
            unlinkSync(outputFile);
        } catch {
            /* временный файл — не критично, если уже удалён или недоступен */
        }
        const dir = path.dirname(outputFile);
        if (tmpPrefix && path.basename(dir).startsWith(tmpPrefix)) {
            try {
                rmSync(dir, { recursive: true, force: true });
            } catch {
                /* временный каталог — не критично, если уже удалён или недоступен */
            }
        }
    }

    let report;
    try {
        report = JSON.parse(raw);
    } catch (e) {
        // Файл к этому моменту уже удалён в finally — путь бесполезен; показываем начало
        // самого нераспарсенного вывода, иначе битый отчёт пришлось бы отлаживать вслепую.
        throw new Error(
            `список тестов vitest не распарсился: ${e.message} — начало вывода: ` +
                `${raw.slice(0, 200)}`,
        );
    }

    return { report, status: result.status, stderr: result.stderr };
}
