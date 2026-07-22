#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectTestsJson, countTests } from './test-count.mjs';

// #156: храповик числа тестов — гейт-чек, краснящий гейт, когда число собранных unit-тестов
// падает НИЖЕ эталона. Закрываемый класс отказа: гейт зелёный при ослабшей проверке
// (кто-то удалил/выключил тесты, покрытие формально держится). Порог coverage (#82) это не
// ловит — покрытая строка ≠ проверенная; храповик дополняет его, не заменяет.
//
// Число берётся из scripts/test-count.mjs (`vitest list --json`, сбор без прогона, ~1с) —
// поэтому чек стоит в НАЧАЛЕ fail-fast порядка гейта и не дублирует 20-секундный `test`.
// Эталон — scripts/test-count.baseline.json (тот же паттерн, что security-audit.baseline:
// осознанное снижение = правка count в том же PR с обоснованием в reason).
const BASELINE_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'test-count.baseline.json',
);

export function loadBaseline(readFn = readFileSync, file = BASELINE_PATH) {
    const raw = JSON.parse(readFn(file, 'utf8'));
    const n = raw?.count;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new Error(
            `test-count.baseline.json без корректного count — неожиданный формат ` +
                `(получено: ${JSON.stringify(n)})`,
        );
    }
    return raw;
}

// Храповик: собрано НИЖЕ эталона — красный; равно или выше — зелёный. Рост эталона не
// требует (растущее число проходит без правки baseline — #156). Сообщение красного
// называет, скольких тестов не досчитались (эталон, факт, нехватка), и путь легального
// снижения — иначе чини-сессия не поймёт, чинить регресс или осознанно опустить эталон.
export function checkRatchet(actual, baseline) {
    const expected = baseline.count;
    if (actual < expected) {
        const missing = expected - actual;
        return {
            ok: false,
            message:
                `тестов стало меньше эталона: было ${expected}, собрано ${actual} ` +
                `(не хватает ${missing}). Либо верни пропавшие тесты, либо, если удаление ` +
                `осознанное (рефактор, дедупликация, устаревший сценарий), снизь count в ` +
                `scripts/test-count.baseline.json в том же PR с обоснованием в reason.`,
        };
    }
    const grew = actual - expected;
    return {
        ok: true,
        message:
            `число тестов не упало ниже эталона (эталон ${expected}, собрано ${actual})` +
            (grew > 0 ? ` — прирост ${grew}, эталон можно поднять` : ''),
    };
}

// #157: сборка чека в одну тестируемую функцию — иначе fail-closed на битых/недоверенных
// данных (нечитаемый эталон, отчёт репортёра не распарсился или неожиданной формы) живёт
// только внутри main() и непроверяем без спавна процесса. Мягкого режима нет: единственный
// catch превращает ЛЮБУЮ ошибку чтения в { ok: false }, ни один путь не возвращает
// { ok: true } на основании того, что «прочитать не вышло, но авось всё в порядке».
export function runRatchetCheck({
    loadBaselineFn = loadBaseline,
    collectTestsJsonFn = collectTestsJson,
    countTestsFn = countTests,
} = {}) {
    let baseline;
    let actual;
    try {
        baseline = loadBaselineFn();
        actual = countTestsFn(collectTestsJsonFn());
    } catch (e) {
        return { ok: false, message: e.message };
    }
    return checkRatchet(actual, baseline);
}

function main() {
    const { ok, message } = runRatchetCheck();
    if (!ok) {
        console.error(`⛔ test-ratchet: ${message}`);
        process.exit(1);
    }
    console.log(`✅ test-ratchet: ${message}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
