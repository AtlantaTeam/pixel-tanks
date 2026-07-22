#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ONLY_TEST_GLOBS as TEST_FILE_GLOBS } from './test-only-detect.mjs';

// #161: осознанные исключения по .skip через baseline-механизм — вариант (а)
// (docs/ralph-reliability/phase4-only-skip-detect/research.md, #159): гейт красный на
// ЛЮБОЙ новый it.skip/describe.skip/test.skip в unit-тестах, кроме точечных исключений,
// зафиксированных в scripts/skip-baseline.json с обоснованием (reason).
//
// В отличие от .only (#160), у vitest нет нативного флага «запретить .skip» (--allowOnly
// решает ровно вопрос .only, .skip — легитимный конструкт движка, отключать его нечем).
// Поэтому здесь `git grep` — НЕ подсказка к сообщению (как в test-only-detect.mjs), а
// единственный источник решения red/green: любой код git grep, кроме 0 (есть совпадения)
// и 1 (совпадений нет), — сбой самого детекта и обязан красить гейт (fail-closed), не
// молча трактоваться как «skip не найден».
const BASELINE_REPO_PATH = 'scripts/skip-baseline.json';
const BASELINE_PATH = path.join(import.meta.dirname, 'skip-baseline.json');

// Каноничная форма — `it.skip(`/`test.skip(`/`describe.skip(`, включая модификаторные
// цепочки (`it.concurrent.skip(`), тем же паттерном, что ONLY_PATTERN в test-only-detect.mjs.
const SKIP_PATTERN = '\\b(it|test|describe)(\\.[A-Za-z]+)*\\.skip[[:space:]]*\\(';

function parseGrepOutput(stdout) {
    return stdout
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

// Источник решения red/green целиком: код 0 — есть находки (парсим), код 1 — находок нет
// (легитимный «чисто»), ЛЮБОЙ другой код (128 — не git-репозиторий, 2 — битый regex, …) —
// throw, а не пустой массив: молчаливое «не нашли» здесь означало бы ложный зелёный.
export function locateSkipUsages(spawnFn = spawnSync) {
    const result = spawnFn(
        'git',
        ['grep', '--untracked', '-n', '-E', SKIP_PATTERN, '--', ...TEST_FILE_GLOBS],
        { encoding: 'utf8' },
    );
    if (result.status === 0) return parseGrepOutput(result.stdout || '');
    if (result.status === 1) return [];
    const stderrTail = (result.stderr || '').trim().slice(-500);
    throw new Error(
        `git grep для детекта .skip завершился неожиданно (код ${result.status}) — детект ` +
            `.skip целиком опирается на этот вызов, тихого "не нашли" тут нет` +
            `${stderrTail ? `: ${stderrTail}` : ''}`,
    );
}

// glob → RegExp: поддержка `**` (в т.ч. `**/` как «ноль или больше сегментов пути») и `*`
// (любые символы внутри одного сегмента) — тот же синтаксис, которым уже пишут пути в
// TEST_FILE_GLOBS и research.md. Не претендует на полноту glob-стандарта — ровно то
// подмножество, которым в этом проекте описывают пути к тестам.
export function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            i++;
            if (glob[i + 1] === '/') {
                re += '(?:.*/)?';
                i++;
            } else {
                re += '.*';
            }
        } else if (c === '*') {
            re += '[^/]*';
        } else if ('.+^${}()|[]\\'.includes(c)) {
            re += `\\${c}`;
        } else {
            re += c;
        }
    }
    return new RegExp(`^${re}$`);
}

// Fail-closed по образцу security-audit.baseline/test-count.baseline: нечитаемый JSON,
// неожиданная форма или запись без обоснования — throw, не «пропустим». Уникально для
// этого baseline (в отличие от security-audit) — нет разделения на «апстрим-дрейф» и
// «сам притащил»: скип всегда пишет автор PR сам, поэтому единственное требование к
// исключению — непустой reason и валидный path/pattern.
export function loadBaseline(readFn = readFileSync, file = BASELINE_PATH) {
    const raw = JSON.parse(readFn(file, 'utf8'));
    const skips = raw?.skips;
    if (!Array.isArray(skips)) {
        throw new Error(
            `${BASELINE_REPO_PATH} без корректного массива skips — неожиданный формат ` +
                `(получено: ${JSON.stringify(skips)})`,
        );
    }
    for (const entry of skips) {
        if (typeof entry?.path !== 'string' || !entry.path.trim()) {
            throw new Error(
                `запись baseline без корректного path (получено: ${JSON.stringify(entry?.path)})`,
            );
        }
        if (typeof entry?.pattern !== 'string' || !entry.pattern.trim()) {
            throw new Error(
                `запись baseline "${entry.path}" без корректного pattern ` +
                    `(получено: ${JSON.stringify(entry?.pattern)})`,
            );
        }
        try {
            new RegExp(entry.pattern);
        } catch (e) {
            throw new Error(
                `запись baseline "${entry.path}": pattern не компилируется как regex — ${e.message}`,
            );
        }
        if (typeof entry?.reason !== 'string' || !entry.reason.trim()) {
            throw new Error(
                `запись baseline "${entry.path}" без reason — исключение из детекта .skip ` +
                    `должно быть обосновано (почему этот скип не потеря покрытия)`,
            );
        }
    }
    return raw;
}

export function matchesBaselineEntry(usage, entry) {
    return (
        globToRegExp(entry.path).test(usage.file) && new RegExp(entry.pattern).test(usage.snippet)
    );
}

// Находки, НЕ покрытые ни одной записью baseline — они и красят гейт.
export function findUnexcusedSkips(usages, baseline) {
    const skips = baseline?.skips ?? [];
    return usages.filter((u) => !skips.some((entry) => matchesBaselineEntry(u, entry)));
}

export function checkSkip(usages, baseline) {
    if (usages.length === 0) {
        return { ok: true, message: '.skip не найден' };
    }
    const unexcused = findUnexcusedSkips(usages, baseline);
    if (unexcused.length === 0) {
        return {
            ok: true,
            message:
                `.skip найден (${usages.length}), все покрыты исключением в ` +
                `${BASELINE_REPO_PATH} с обоснованием`,
        };
    }
    const location = unexcused.map((u) => `${u.file}:${u.line} (${u.snippet})`).join(', ');
    return {
        ok: false,
        message:
            `обнаружен новый .skip в unit-тестах вне baseline-исключений — режим (а): гейт ` +
            `отвергает любой не обоснованный skip (docs/ralph-reliability/phase4-only-skip-detect/research.md). ` +
            `Место: ${location}. Либо убери .skip, либо добавь точечное исключение с reason в ` +
            `${BASELINE_REPO_PATH}.`,
    };
}

// Сборка чека в одну тестируемую функцию (аналог runRatchetCheck/runOnlyDetectCheck):
// единственный catch превращает ЛЮБУЮ ошибку (сбой git grep, нечитаемый/невалидный
// baseline) в { ok: false } — мягкого режима на недоверенных данных нет.
export function runSkipDetectCheck({
    locateSkipUsagesFn = locateSkipUsages,
    loadBaselineFn = loadBaseline,
} = {}) {
    try {
        const usages = locateSkipUsagesFn();
        const baseline = loadBaselineFn();
        return checkSkip(usages, baseline);
    } catch (e) {
        return { ok: false, message: e.message };
    }
}

function main() {
    const { ok, message } = runSkipDetectCheck();
    if (!ok) {
        console.error(`⛔ test-skip-detect: ${message}`);
        process.exit(1);
    }
    console.log(`✅ test-skip-detect: ${message}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
