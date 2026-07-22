#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { collectTestsJson, countTests } from './test-count.mjs';
import { fetchOriginMain } from './security-audit.mjs';

// telegram-notifier.js — CommonJS-модуль раннера (#85), самостоятельный: он не тянет
// ralph.js и уже носит собственный guardSideEffect, поэтому в тестах побочка не улетит.
const { sendTelegramMessage } = createRequire(import.meta.url)(
    '../.claude/ralph/telegram-notifier.js',
);

// #156: храповик числа тестов — гейт-чек, краснящий гейт, когда число собранных unit-тестов
// падает НИЖЕ эталона. Закрываемый класс отказа: гейт зелёный при ослабшей проверке
// (кто-то удалил тесты, покрытие формально держится). Порог coverage (#82) это не ловит —
// покрытая строка ≠ проверенная; храповик дополняет его, не заменяет. Выключенные
// (.only/.skip) храповик НЕ ловит: vitest list считает и пропущенные тесты, их детект —
// отдельные #159/#162.
//
// Число берётся из scripts/test-count.mjs (`vitest list --json`, сбор без прогона, ~1с) —
// поэтому чек стоит в НАЧАЛЕ fail-fast порядка гейта и не дублирует 20-секундный `test`.
// Эталон — scripts/test-count.baseline.json (тот же паттерн, что security-audit.baseline:
// осознанное снижение = правка count в том же PR с обоснованием в reason).
const BASELINE_REPO_PATH = 'scripts/test-count.baseline.json';
const BASELINE_PATH = path.join(import.meta.dirname, 'test-count.baseline.json');

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

// #155/#207: снижение эталона — единственный способ ослабить храповик, и делает его тот же
// агент, что чинит гейт; «предохранитель, который исполнитель снимает сам, предохранителем
// не является» (инцидент 22.07, #207). Барьер в духе security-audit: базовую версию эталона
// берём из origin/main (её PR не переписывает), а не из дерева проверяемого PR.
//
// null — эталон впервые появляется в этом PR (в origin/main файла ещё нет): снижать нечего.
// ЛЮБАЯ другая ошибка git — сбой (как в gitBaseBaseline security-audit): битый объект или
// отсутствующий ref нельзя молча трактовать как «базы нет», иначе это станет каналом обхода
// на мусорных данных.
export function gitBaseBaseline(spawnFn = spawnSync, file = `origin/main:${BASELINE_REPO_PATH}`) {
    const r = spawnFn('git', ['show', file], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) {
        const err = r.stderr?.trim() || '';
        if (/does not exist in|invalid object name|exists on disk, but not in/i.test(err))
            return null;
        throw new Error(
            `не смог прочитать базовую версию эталона из origin/main: ${err || `код ${r.status}`}`,
        );
    }
    const parsed = JSON.parse(r.stdout);
    const n = parsed?.count;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new Error(
            `базовая версия test-count.baseline.json без корректного count — сверка снижения ` +
                `ненадёжна (получено: ${JSON.stringify(n)})`,
        );
    }
    return parsed;
}

// Боевой источник базового эталона: сперва освежаем origin/main (checksGreen фетчит только
// ветку PR — база может быть несвежей), потом читаем. Fail-closed: сравнивать с устаревшей
// базой хуже, чем честно покраснеть. В тестах подменяется целиком через gitBaseBaselineFn.
function defaultBaseBaseline() {
    fetchOriginMain();
    return gitBaseBaseline();
}

// Барьер снижения эталона относительно origin/main. Снижение без непустого reason — красный;
// снижение с reason — зелёный, но помечается accepted: main() шлёт о нём громкий пуш, чтобы
// ослабление проверки не проходило молча (как acceptedPushText в security-audit). База
// отсутствует (null) или эталон не снижен — барьер молчит.
export function checkBaselineReduction(headBaseline, baseBaseline) {
    if (baseBaseline == null) return { ok: true };
    if (headBaseline.count >= baseBaseline.count) return { ok: true };
    const reason = typeof headBaseline.reason === 'string' ? headBaseline.reason.trim() : '';
    const drop = baseBaseline.count - headBaseline.count;
    if (!reason) {
        return {
            ok: false,
            message:
                `эталон числа тестов снижен с ${baseBaseline.count} до ${headBaseline.count} ` +
                `(на ${drop}) без обоснования. Снижение эталона гейт пропускает только с ` +
                `непустым reason в scripts/test-count.baseline.json — почему тестов стало ` +
                `меньше и почему это не потеря покрытия.`,
        };
    }
    return {
        ok: true,
        accepted: { from: baseBaseline.count, to: headBaseline.count, drop, reason },
    };
}

export function reductionPushText({ from, to, drop, reason }) {
    return (
        `⚠️  эталон числа тестов снижен: ${from} → ${to} (на ${drop}). ` +
        `Обоснование из PR: ${reason}`
    );
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
            (grew > 0
                ? ` — прирост ${grew}; подтяжку эталона до факта после мерджа ведёт #229`
                : ''),
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
    gitBaseBaselineFn = defaultBaseBaseline,
} = {}) {
    let baseline;
    let baseBaseline;
    let actual;
    try {
        baseline = loadBaselineFn();
        baseBaseline = gitBaseBaselineFn();
        actual = countTestsFn(collectTestsJsonFn());
    } catch (e) {
        return { ok: false, message: e.message };
    }
    // Барьер снижения эталона — ДО сверки с фактом: если эталон опустили без права,
    // разбирать по нему храповик бессмысленно (порядок как в enforceBaselinePolicy, #207).
    const reduction = checkBaselineReduction(baseline, baseBaseline);
    if (!reduction.ok) return reduction;
    const result = checkRatchet(actual, baseline);
    return reduction.accepted ? { ...result, accepted: reduction.accepted } : result;
}

function main() {
    const { ok, message, accepted } = runRatchetCheck();
    if (!ok) {
        console.error(`⛔ test-ratchet: ${message}`);
        process.exit(1);
    }
    if (accepted) {
        const text = reductionPushText(accepted);
        console.warn(text); // текст уже начинается с ⚠️ — второй эмодзи не нужен
        // sendTelegramMessage спроектирован fail-open и НИКОГДА не бросает (#85): недоставка
        // не краснит гейт (снижение уже признано легитимным), но обязана быть видна в выводе.
        const delivered = sendTelegramMessage(text, { logFn: console.warn });
        if (!delivered) {
            console.warn(
                `⚠️  пуш о снижении эталона тестов НЕ доставлен — событие осталось только ` +
                    `в выводе гейта и логе раннера, проверь RALPH_TG_* и сеть`,
            );
        }
    }
    console.log(`✅ test-ratchet: ${message}`);
}

if (import.meta.filename === process.argv[1]) main();
