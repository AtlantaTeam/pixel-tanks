#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { appendJournalEntry } from './review-findings-journal.mjs';

// #170: дешёвый шаг фиксации находок «найдено после» — ручная половина метрики.
// CLI: node scripts/record-found-after.mjs <milestone> <blocker> <major> <minor> <nit> [--pr <N>]
// Пример: node scripts/record-found-after.mjs "Фаза 6" 1 2 0 3
// С привязкой к PR: node scripts/record-found-after.mjs "Фаза 6" 1 2 0 3 --pr 235

export function parseFoundAfterArgs(argv) {
    if (argv.length < 6) {
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
    if (argv.includes('--pr')) {
        const prIndex = argv.indexOf('--pr');
        if (prIndex >= 0 && prIndex + 1 < argv.length) {
            const prValue = argv[prIndex + 1];
            if (!/^[1-9]\d*$/.test(prValue)) {
                throw new Error('--pr должен быть положительным целым');
            }
            pr = parseInt(prValue, 10);
        }
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
