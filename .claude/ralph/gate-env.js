'use strict';

// #188 (Изоляция ralph · Фаза 4): ALLOWLIST-санация окружения чеков гейта.
//
// ЗАЧЕМ. Гейт мерджа гоняет чеки (build/lint/test/…) и `npm ci` в дереве раннера, а
// у раннера в окружении лежат секреты петли (GH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN,
// RALPH_TG_BOT_TOKEN — инвариант 11 CLAUDE.md). Любой из этих процессов — код из
// проверяемого PR: тест/скрипт сборки видит `process.env` и может утащить секрет
// (класс #209). Санация отрезает секреты от env дочерних процессов чеков.
//
// ПОЧЕМУ ALLOWLIST, А НЕ BLOCKLIST. Blocklist («вычесть GH_TOKEN, CLAUDE_…») молча
// пропустит СЛЕДУЮЩИЙ секрет — новую переменную, про которую забыли. Allowlist
// перечисляет то, что чекам НУЖНО; всё остальное (включая ещё не придуманные секреты)
// отсекается по умолчанию — fail-closed по духу инварианта 1. Сам список лежит в
// репозитории (gate-env-allowlist.json), не в хардкоде: добавление переменной видно в
// диффе и попадает под эскалацию ревью (`.claude/ralph/**` в review.escalateOnPaths),
// а не растворяется в правке кода.
//
// ГРАНИЦЫ. Санация закрывает ТОЛЬКО env-канал. Файловый канал к тем же секретам
// (~/.config/gh/hosts.yml, ~/.claude/.credentials.json) остаётся открытым, пока в
// allowlist есть HOME, — это остаточный риск, а не песочница (#192). Здесь только
// чистые функции + загрузчик; точки перехвата (checksGreen, installFn) подключает #189.

const fs = require('node:fs');
const path = require('node:path');

// Список — рядом с модулем, в репозитории (не в env-файле секретов и не в коде).
const DEFAULT_ALLOWLIST_PATH = path.join(__dirname, 'gate-env-allowlist.json');

// Ключи, которыми объект-env мог бы отравить прототип, если строить его обычным `{}`.
// Санируемый env приходит извне (в т.ч. из окружения, куда переменную мог подложить
// код PR) — переменная с именем `__proto__`/`constructor` не должна менять прототип
// результата. Результат строим через Object.create(null), а такие имена отбрасываем.
const UNSAFE_ENV_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Приводит распарсенный JSON к рабочей форме и валидирует его fail-closed: кривой
// allowlist — это стоп, а не «пустой список» (пустой отрезал бы PATH и покрасил бы гейт
// инфраструктурной ошибкой, а не отсутствием секретов). Возвращает { exact:Set, prefixes:[] }.
function normalizeAllowlist(parsed, source = '<inline>') {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error(
            `gate-env allowlist (${source}): ожидается объект с полями "exact" и "prefixes"`,
        );
    const { exact, prefixes } = parsed;
    if (!Array.isArray(exact) || !Array.isArray(prefixes))
        throw new Error(
            `gate-env allowlist (${source}): поля "exact" и "prefixes" обязаны быть массивами`,
        );
    const check = (arr, field) => {
        for (const v of arr) {
            if (typeof v !== 'string' || v.length === 0)
                throw new Error(
                    `gate-env allowlist (${source}): в "${field}" допустимы только непустые строки, встретилось ${JSON.stringify(v)}`,
                );
        }
    };
    check(exact, 'exact');
    check(prefixes, 'prefixes');
    return { exact: new Set(exact), prefixes: [...prefixes] };
}

// Читает allowlist из файла репозитория. readFileFn инжектируется для тестов; в проде —
// fs.readFileSync. Нечитаемый/непарсящийся файл → бросок (fail-closed): без списка
// санировать нельзя, а «санировать всем дефолтом» вернуло бы секреты в env.
function loadGateEnvAllowlist(filePath = DEFAULT_ALLOWLIST_PATH, readFileFn = fs.readFileSync) {
    let raw;
    try {
        raw = readFileFn(filePath, 'utf8');
    } catch (e) {
        throw new Error(
            `gate-env allowlist не читается (${filePath}): ${e.message} — санация fail-closed, чеки без allowlist не запускаем`,
        );
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`gate-env allowlist не парсится как JSON (${filePath}): ${e.message}`);
    }
    return normalizeAllowlist(parsed, filePath);
}

// Переменная разрешена, если она в exact ЛИБО начинается с одного из prefixes
// (семейства вроде LC_*). Пустой prefix запрещён валидацией — иначе пропускал бы всё.
function isAllowed(name, allowlist) {
    if (allowlist.exact.has(name)) return true;
    return allowlist.prefixes.some((p) => name.startsWith(p));
}

// Возвращает НОВЫЙ env, где остались только разрешённые переменные. Исходный объект не
// мутируется. Результат — Object.create(null): у него нет унаследованных ключей и его
// нельзя отравить именем `__proto__` из входного env (см. UNSAFE_ENV_KEYS).
function sanitizeEnv(env, allowlist) {
    const out = Object.create(null);
    for (const key of Object.keys(env)) {
        if (UNSAFE_ENV_KEYS.has(key)) continue;
        if (isAllowed(key, allowlist)) out[key] = env[key];
    }
    return out;
}

// Удобная обёртка для точек перехвата (#189): загрузить allowlist и сразу санировать env.
// Дефолты — боевые (файл рядом, process.env), в тестах подменяются.
function buildSanitizedGateEnv({
    env = process.env,
    allowlistPath = DEFAULT_ALLOWLIST_PATH,
    readFileFn = fs.readFileSync,
} = {}) {
    return sanitizeEnv(env, loadGateEnvAllowlist(allowlistPath, readFileFn));
}

module.exports = {
    DEFAULT_ALLOWLIST_PATH,
    UNSAFE_ENV_KEYS,
    normalizeAllowlist,
    loadGateEnvAllowlist,
    isAllowed,
    sanitizeEnv,
    buildSanitizedGateEnv,
};
