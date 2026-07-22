#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// #154: источник числа прогнанных unit-тестов для будущего храповика (#155/#156) —
// детерминированный JSON-репортёр vitest (Jest-совместимый формат: numTotalTests и
// соседние поля — контракт vitest, не наш), а НЕ парсинг человекочитаемого stdout.
// Текстовый вывод (`vitest run`) меняется между версиями/локалями и никогда не был
// контрактом — regex по нему рано или поздно молча ломается на безобидном апдейте.
//
// --outputFile, не голый stdout: json-репортёр без outputFile печатает JSON в тот же
// stdout, где могут всплыть console.log/warn из самих тестов — один смешанный поток
// JSON.parse не переживёт. Файл на диске — чистый канал.
function defaultOutputFile() {
    return path.join(os.tmpdir(), `vitest-report-${process.pid}-${Date.now()}.json`);
}

// Ненулевой код спавна здесь ОЖИДАЕМ (упавшие тесты — обычный исход) — не сбой запуска,
// поэтому статус процесса не проверяем. Сбой самого запуска (vitest не смог стартовать)
// не пишет outputFile вовсе — это и ловится ниже при чтении, fail-closed.
//
// --no-install у npx: без него отсутствие локального vitest ушло бы в сеть за пакетом —
// ровно та зависимость гейта от сети, которая уже один раз красила build (#206).
export function runTestsJson(spawnFn = spawnSync, outputFile = defaultOutputFile()) {
    spawnFn(
        'npx',
        ['--no-install', 'vitest', 'run', '--reporter=json', `--outputFile=${outputFile}`],
        {
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
        },
    );

    let raw;
    try {
        raw = readFileSync(outputFile, 'utf8');
    } catch (e) {
        throw new Error(
            `vitest не записал JSON-отчёт в ${outputFile} — сбой запуска: ${e.message}`,
        );
    } finally {
        try {
            unlinkSync(outputFile);
        } catch {
            /* временный файл — не критично, если уже удалён или недоступен */
        }
    }

    try {
        return JSON.parse(raw);
    } catch (e) {
        throw new Error(`JSON-отчёт vitest в ${outputFile} не распарсился: ${e.message}`);
    }
}

// Формат отчёта зафиксирован (vitest JSON-репортёр, Jest-совместимый): численное поле
// numTotalTests. Нечитаемый/неожиданный формат — throw, не «посчитаем как 0»: тихий 0
// на сломанном отчёте будущий храповик (#156) прочитал бы как «все тесты пропали» и
// покрасил бы гейт по ложной причине, либо — того хуже — как «тестов нет, порог 0».
export function countTests(report) {
    const n = report?.numTotalTests;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new Error(
            `vitest JSON-отчёт без корректного numTotalTests — формат репортёра неожиданный ` +
                `(получено: ${JSON.stringify(n)})`,
        );
    }
    return n;
}

function main() {
    let report;
    try {
        report = runTestsJson();
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
