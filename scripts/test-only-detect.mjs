#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// #160: детект it.only/describe.only в unit-гейте. Vitest умеет это нативно — PRD
// (docs/ralph-reliability/prd.md) решил, что аналога forbidOnly (Playwright, CI=1) у
// vitest нет, но это неверно: конфиг `allowOnly` (флаг `--allowOnly=false`) делает ровно
// то же самое, проверено реальным прогоном. `vitest list` (сбор БЕЗ прогона, как в
// test-count.mjs #154) с этим флагом завершается ненулевым кодом, если .only есть
// ГДЕ УГОДНО в дереве — это авторитетный, семантически верный сигнал (парсит реальное
// тест-дерево движком, не regex по исходникам).
//
// Ловушка: в отличие от одиночного файла (там .only локально фильтрует список до себя),
// на прогоне ВСЕГО дерева отчёт `vitest list` остаётся ПОЛНЫМ (все ~1000 тестов из всех
// файлов, проверено запуском) — .only НЕ сужает список глобально, только код выхода
// становится ненулевым. Значит report из collectOnlyReport для сообщения «файл и место
// находки» бесполезен (пришлось бы показать сотни несвязанных файлов). Поэтому локация —
// отдельный шаг: `git grep` по исходникам тест-файлов (быстрый, точный regex по
// каноничной форме it.only(/describe.only( — единственный синтаксис, которым в этом
// проекте пишут тесты). git grep — только ПОДСКАЗКА для сообщения; решение red/green
// целиком на vitest (fail-closed: если grep ничего не нашёл, гейт всё равно красный).
function defaultOutputFile() {
    return path.join(mkdtempSync(path.join(os.tmpdir(), 'test-only-detect-')), 'vitest-list.json');
}

export function collectOnlyReport(spawnFn = spawnSync, outputFile = defaultOutputFile()) {
    const result = spawnFn(
        'npx',
        [
            '--no-install',
            'vitest',
            'list',
            '--no-isolate',
            '--allowOnly=false',
            `--json=${outputFile}`,
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );

    let raw;
    try {
        raw = readFileSync(outputFile, 'utf8');
    } catch (e) {
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
        try {
            unlinkSync(outputFile);
        } catch {
            /* временный файл — не критично, если уже удалён или недоступен */
        }
        const dir = path.dirname(outputFile);
        if (path.basename(dir).startsWith('test-only-detect-')) {
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
        throw new Error(
            `список тестов vitest не распарсился: ${e.message} — начало вывода: ` +
                `${raw.slice(0, 200)}`,
        );
    }

    return { report, status: result.status };
}

// Те же glob'ы, которыми vitest.config.ts описывает test-файлы обоих проектов (app + ralph).
export const ONLY_TEST_GLOBS = [
    'src/**/*.test.ts',
    'src/**/*.test.tsx',
    '.claude/ralph/**/*.test.js',
    '.claude/ralph/**/*.test.ts',
    '*.config.test.ts',
    'scripts/**/*.test.js',
    'scripts/**/*.test.ts',
];

// Каноничная форма — `it.only(`/`test.only(`/`describe.only(`, включая модификаторные
// цепочки (`it.concurrent.only(`). Переименованные импорты (`import { it as t }`) регекс
// не поймает — редкий случай для этого проекта (ESLint/конвенции не поощряют алиасы), и
// решение red/green это не задевает: он только подсказка к сообщению.
const ONLY_PATTERN = '\\b(it|test|describe)(\\.[A-Za-z]+)*\\.only[[:space:]]*\\(';

// git grep — best-effort локатор для сообщения красного гейта, НЕ источник решения
// (см. checkOnly). Статус 1 (нет совпадений) или 128 (не git-репозиторий/иная ошибка) —
// одинаково «подсказки нет», не throw: отсутствие локации не должно тушить уже принятое
// red-решение vitest.
export function locateOnlyUsages(spawnFn = spawnSync) {
    const result = spawnFn(
        'git',
        ['grep', '--untracked', '-n', '-E', ONLY_PATTERN, '--', ...ONLY_TEST_GLOBS],
        { encoding: 'utf8' },
    );
    if (result.status !== 0 || typeof result.stdout !== 'string') return [];
    return result.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const sepIdx = line.indexOf(':');
            const file = line.slice(0, sepIdx);
            const rest = line.slice(sepIdx + 1);
            const lineSepIdx = rest.indexOf(':');
            return {
                file,
                line: rest.slice(0, lineSepIdx),
                snippet: rest.slice(lineSepIdx + 1).trim(),
            };
        });
}

// Код 0 — .only нет, зелёный. Ненулевой — allowOnly сработал; отчёт обязан быть непустым
// массивом (форма подтверждена реальным сбором), иначе формат неожиданный — throw, не
// «зелёный» (fail-closed, аналог countTests в test-count.mjs). Место находки — из
// locateOnlyUsagesFn (best-effort); если пусто, гейт всё равно красный, сообщение честно
// говорит, что автопоиск места не сработал.
export function checkOnly({ status, report }, locateOnlyUsagesFn = locateOnlyUsages) {
    if (status === 0) {
        return {
            ok: true,
            message: `.only не найден (собрано тестов: ${Array.isArray(report) ? report.length : '?'})`,
        };
    }
    if (!Array.isArray(report) || report.length === 0) {
        throw new Error(
            `vitest list --allowOnly=false завершился с кодом ${status}, но не назвал ни одного ` +
                `теста — формат вывода неожиданный (получено: ${JSON.stringify(report)})`,
        );
    }
    const usages = locateOnlyUsagesFn();
    const location = usages.length
        ? usages.map((u) => `${u.file}:${u.line}`).join(', ')
        : 'точное место не нашёл статический поиск — ищи `it.only`/`describe.only`/`test.only` вручную';
    return {
        ok: false,
        message:
            `обнаружен .only в unit-тестах — гейт отвергает частичный прогон (аналог ` +
            `forbidOnly Playwright под CI=1, определено через vitest --allowOnly=false). ` +
            `Место: ${location}. Убери .only перед мерджем.`,
    };
}

// Сборка чека в одну тестируемую функцию (аналог runRatchetCheck, #157): единственный
// catch превращает ЛЮБУЮ ошибку (сбоя сбора или неожиданного формата отчёта) в
// { ok: false } — ни один путь не возвращает { ok: true } на основании «не разобрались,
// но авось всё в порядке».
export function runOnlyDetectCheck({
    collectOnlyReportFn = collectOnlyReport,
    locateOnlyUsagesFn = locateOnlyUsages,
} = {}) {
    try {
        return checkOnly(collectOnlyReportFn(), locateOnlyUsagesFn);
    } catch (e) {
        return { ok: false, message: e.message };
    }
}

function main() {
    const { ok, message } = runOnlyDetectCheck();
    if (!ok) {
        console.error(`⛔ test-only-detect: ${message}`);
        process.exit(1);
    }
    console.log(`✅ test-only-detect: ${message}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
