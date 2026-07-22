#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectVitestList, defaultOutputFile } from './test-detect-shared.mjs';

// #154: источник числа unit-тестов для храповика (#156) — детерминированный машинный
// отчёт vitest, а НЕ парсинг человекочитаемого stdout (текстовый вывод меняется между
// версиями/локалями и никогда не был контрактом — regex по нему рано или поздно молча
// ломается на безобидном апдейте).
//
// `vitest list` (СБОР тест-кейсов без прогона), а не `vitest run` (#156): храповику нужно
// только число существующих тестов, а не результат прогона. Число совпадает с numTotalTests
// полного прогона (сбор считает те же тест-кейсы, включая пропущенные) — проверено на этом
// репозитории, — поэтому гейт-чек храповика попадает в НАЧАЛО fail-fast порядка
// («секундный», #156) и не дублирует ~20-секундный `test`, который гейт и так гоняет.
//
// --no-isolate — вот что делает чек «секундным»: голый `vitest list` тратит ~20с (замер),
// потому что изоляция поднимает свежее окружение (happy-dom) под КАЖДЫЙ из ~50 файлов
// app-проекта; для СБОРА (файлы только импортируются ради перечня it(), тесты не
// исполняются) изоляция не нужна. Без неё — ~6с, и число то же (флаг влияет на семантику
// ИСПОЛНЕНИЯ, не на сбор — проверено). Это нижний предел честного независимого подсчёта:
// трансформ исходников app эсбилдом; быстрее только читая артефакт чужого прогона, но тогда
// чек уже не «в начале» и зависит от порядка чеков.
//
// Пул НЕ трогаем (дефолтные forks): `--pool=threads` под `--no-isolate` даёт НЕДЕТЕРМИНИРО-
// ванный счёт (замер: 919/939/930 в разных прогонах) — потоки делят память и гонятся на
// сборе, а храповику это отравой: счёт обязан быть детерминированным, иначе гейт краснеет по
// флаку, а не по потере тестов. Forks — отдельные процессы, гонки нет, счёт стабилен от
// прогона к прогону (проверено 5×).
//
// Сбор списка — общим collectVitestList (scripts/test-detect-shared.mjs): вся механика
// (--json=<file>, --no-isolate ~6с, --no-install без сети #206, приватный tmp-каталог,
// fail-closed на нечитаемом/битом отчёте) вынесена туда, потому что тот же паттерн нужен
// only-детекту (ревью PR #230). Храповику нужен только список — возвращаем report (код
// выхода спавна тут безразличен: решение принимает countTests по длине массива).
export function collectTestsJson(
    spawnFn = spawnSync,
    outputFile = defaultOutputFile('test-count-'),
) {
    return collectVitestList({ spawnFn, outputFile, tmpPrefix: 'test-count-' }).report;
}

// Формат зафиксирован (vitest list --json): МАССИВ записей о тест-кейсах, у каждой строковые
// name и file. Число тестов = длина массива. Неожиданный формат (не массив, запись без
// строковых name/file) — throw, не «посчитаем как есть»: тихий счёт по сломанному отчёту
// храповик (#156) прочитал бы как «тесты пропали» и покрасил бы гейт по ложной причине.
export function countTests(report) {
    if (!Array.isArray(report)) {
        throw new Error(
            `vitest list --json вернул не массив — формат репортёра неожиданный ` +
                `(получено: ${JSON.stringify(report)})`,
        );
    }
    for (const entry of report) {
        if (typeof entry?.name !== 'string' || typeof entry?.file !== 'string') {
            throw new Error(
                `запись списка тестов без строковых name/file — формат vitest list изменился ` +
                    `(получено: ${JSON.stringify(entry)})`,
            );
        }
    }
    return report.length;
}

function main() {
    let report;
    try {
        report = collectTestsJson();
    } catch (e) {
        console.error(`⛔ test-count: ${e.message}`);
        process.exit(1);
    }

    let count;
    try {
        count = countTests(report);
    } catch (e) {
        console.error(`⛔ test-count: ${e.message}`);
        process.exit(1);
    }

    console.log(count);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
