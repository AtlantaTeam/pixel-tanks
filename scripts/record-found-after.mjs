#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { appendJournalEntry } from './review-findings-journal.mjs';

// #170: дешёвый шаг фиксации находок «найдено после» — ручная половина метрики.
// CLI: node scripts/record-found-after.mjs <milestone> <blocker> <major> <minor> <nit> [--pr <N>]
//
// ⚠ ВАЖНО (#237): <milestone> обязан ТОЧНО совпадать с `phase.milestone` из
// ralph.config.json — по нему авто-половина (review-loop) и ручная (found-after) сшиваются.
// Сокращённое «Фаза 6» даст записи, которые не сопоставятся с авто-половиной. Полное имя:
//   node scripts/record-found-after.mjs "Наблюдаемость ralph · Фаза 6: Метрика находок ревью" 1 2 0 3
// С привязкой к PR — добавить `--pr 235`.

export function parseFoundAfterArgs(argv) {
    // Позиционных аргументов пять (milestone + 4 счётчика, argv[2..6]) — минимальная длина
    // argv равна 7 (#237: раньше было < 6 и вызов без nit падал не на честном usage, а на
    // «nit … получено: undefined»).
    if (argv.length < 7) {
        throw new Error('Укажи: <milestone> <blocker> <major> <minor> <nit> [--pr <N>]');
    }

    const milestone = argv[2];
    if (typeof milestone !== 'string' || !milestone.trim()) {
        throw new Error('milestone обязан быть непустой строкой');
    }

    const parseNonNegative = (value, name) => {
        if (!/^(0|[1-9]\d*)$/.test(value)) {
            throw new Error(`${name} обязан быть неотрицательным целым (получено: ${value})`);
        }
        return parseInt(value, 10);
    };

    const blocker = parseNonNegative(argv[3], 'blocker');
    const major = parseNonNegative(argv[4], 'major');
    const minor = parseNonNegative(argv[5], 'minor');
    const nit = parseNonNegative(argv[6], 'nit');

    let pr = null;
    const prIndex = argv.indexOf('--pr');
    if (prIndex >= 0) {
        // #237: `--pr` без значения раньше молча давал pr=null — тихая потеря привязки в
        // ручной половине, где главный риск и так дисциплина. Теперь кидаем, как остальные
        // проверки парсера.
        if (prIndex + 1 >= argv.length) {
            throw new Error('--pr требует значение (номер PR)');
        }
        const prValue = argv[prIndex + 1];
        if (!/^[1-9]\d*$/.test(prValue)) {
            throw new Error('--pr должен быть положительным целым');
        }
        pr = parseInt(prValue, 10);
    }

    return {
        milestone,
        blocker,
        major,
        minor,
        nit,
        pr,
    };
}

// Преобразует аргументы в entry для appendJournalEntry.
export function recordFoundAfter(
    { milestone, blocker, major, minor, nit, pr },
    { appendFn = appendJournalEntry } = {},
) {
    const counts = {
        blocker,
        major,
        minor,
        nit,
        unmarked: 0,
        total: blocker + major + minor + nit,
    };

    return appendFn({
        milestone,
        source: 'found-after',
        pr,
        counts,
    });
}

function main() {
    let args;
    try {
        args = parseFoundAfterArgs(process.argv);
    } catch (e) {
        console.error(`⛔ record-found-after: ${e.message}`);
        console.error(
            'Использование: node scripts/record-found-after.mjs <milestone> <blocker> <major> <minor> <nit> [--pr <N>]',
        );
        process.exit(1);
    }

    let entry;
    try {
        entry = recordFoundAfter(args);
    } catch (e) {
        console.error(`⛔ record-found-after: ${e.message}`);
        process.exit(1);
    }

    console.log(JSON.stringify(entry));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
