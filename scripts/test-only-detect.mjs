#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    TEST_FILE_GLOBS,
    collectVitestList,
    defaultOutputFile,
    grepMarkerPattern,
    parseGrepOutput,
} from './test-detect-shared.mjs';

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
//
// Сбор — общим collectVitestList (scripts/test-detect-shared.mjs): та же механика, что у
// храповика (#154), с добавкой --allowOnly=false. Возвращает { report, status, stderr } —
// status авторитетен для .only, stderr прокидывается в checkOnly для диагностики.
export function collectOnlyReport(
    spawnFn = spawnSync,
    outputFile = defaultOutputFile('test-only-detect-'),
) {
    return collectVitestList({
        spawnFn,
        outputFile,
        extraArgs: ['--allowOnly=false'],
        tmpPrefix: 'test-only-detect-',
    });
}

const ONLY_PATTERN = grepMarkerPattern('only');

// git grep — best-effort локатор для сообщения красного гейта, НЕ источник решения
// (см. checkOnly). Статус 1 (нет совпадений) или 128 (не git-репозиторий/иная ошибка) —
// одинаково «подсказки нет», не throw: отсутствие локации не должно тушить уже принятое
// red-решение vitest.
export function locateOnlyUsages(spawnFn = spawnSync) {
    const result = spawnFn(
        'git',
        ['grep', '--untracked', '-n', '-E', ONLY_PATTERN, '--', ...TEST_FILE_GLOBS],
        { encoding: 'utf8' },
    );
    if (result.status !== 0 || typeof result.stdout !== 'string') return [];
    return parseGrepOutput(result.stdout);
}

// Код 0 — .only нет, зелёный. Ненулевой — allowOnly сработал; отчёт обязан быть непустым
// массивом (форма подтверждена реальным сбором), иначе формат неожиданный — throw, не
// «зелёный» (fail-closed, аналог countTests в test-count.mjs). Место находки — из
// locateOnlyUsagesFn (best-effort); если пусто, гейт всё равно красный.
//
// Когда локатор пуст (ревью PR #230, minor): ненулевой код от vitest НЕ обязательно значит
// «.only найден» — сбой одного из projects после записи отчёта, unhandled rejection на
// teardown сбора тоже дают ненулевой код при валидном JSON. Тогда «ищи .only вручную»
// отправило бы чини-сессию искать то, чего нет. Поэтому в эту ветку добавляем хвост stderr
// сбора — истинная причина ненулевого кода видна сразу.
export function checkOnly({ status, report, stderr }, locateOnlyUsagesFn = locateOnlyUsages) {
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
    let location;
    if (usages.length) {
        location = usages.map((u) => `${u.file}:${u.line}`).join(', ');
    } else {
        const stderrTail = (stderr || '').trim().slice(-500);
        location =
            'точное место не нашёл статический поиск — ищи `it.only`/`describe.only`/`test.only` вручную' +
            (stderrTail
                ? ` (ненулевой код мог быть и не из-за .only — хвост stderr сбора: ${stderrTail})`
                : '');
    }
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
