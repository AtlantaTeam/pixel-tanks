#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// #168: счёт находок ревью петли по severity из комментариев PR. Ревью-промпт (ralph.js,
// сессии code review и правок) уже обязывает КАЖДЫЙ комментарий начинать строго с метки
// 🔴 [blocker] / 🟠 [major] / 🟡 [minor] / ⚪ [nit] — парсинг опирается ровно на этот
// контракт формата, не на эвристики по тексту. Модуль сам ничего не гейтит и не пишет
// в журнал (#169) — только читает комментарии PR и считает; используется журналом фазы 6
// как источник автоматизируемой половины метрики.
const SEVERITY_MARKERS = {
    '🔴': 'blocker',
    '🟠': 'major',
    '🟡': 'minor',
    '⚪': 'nit',
};

export const SEVERITY_LEVELS = ['blocker', 'major', 'minor', 'nit'];

// Метка обязана быть ПЕРВЫМ значимым символом комментария (контракт промпта: «строго в
// формате эмодзи+тег»). Эмодзи где-то в середине текста — не разметка severity, а просто
// упоминание/цитата, поэтому не засчитывается.
export function parseSeverity(body) {
    if (typeof body !== 'string') return null;
    const trimmed = body.trim();
    for (const [marker, severity] of Object.entries(SEVERITY_MARKERS)) {
        if (trimmed.startsWith(marker)) return severity;
    }
    return null;
}

// Принимает как строки, так и объекты gh api ({ body }) — вызывающему (fetchPrComments,
// либо тест) не нужно приводить форму заранее. Пустой набор — все счётчики нулевые, это не
// ошибка (PR без единого комментария — легитимный случай, не «сбой чтения»).
//
// Семантика полей (одинакова для обеих половин метрики — review-loop и found-after):
// `total` — ВСЕ учтённые комментарии, включая unmarked (ответы кодер-сессии «поправил» и
// сводки ревью), поэтому всегда `total === blocker + major + minor + nit + unmarked`
// (инвариант проверяет журнал, assertValidCounts). «total: 40» — это 40 комментариев, а
// НЕ 40 находок; находки — сумма severity-бакетов без unmarked. У found-after unmarked = 0
// по построению, там total и число находок совпадают.
//
// #237 (ревью): сводный обзорный комментарий прохода ревью (pulls/reviews[].body) по
// контракту промпта тоже начинается с метки severity, но он ДУБЛИРУЕТ находки, уже
// разложенные по inline-комментариям того же прохода. Чтобы каждый проход не давал
// систематический +1 в бакет своей метки, такие тела помечены `isSummary` и идут в
// unmarked (в total попадают, severity не завышают).
export function countFindingsBySeverity(comments) {
    const counts = { blocker: 0, major: 0, minor: 0, nit: 0, unmarked: 0, total: 0 };
    for (const comment of comments) {
        const isSummary = typeof comment === 'object' && comment?.isSummary === true;
        const body = typeof comment === 'string' ? comment : comment?.body;
        const severity = isSummary ? null : parseSeverity(body);
        if (severity) counts[severity] += 1;
        else counts.unmarked += 1;
        counts.total += 1;
    }
    return counts;
}

// {owner}/{repo} — плейсхолдеры gh api, подставляет сам gh по текущему репозиторию (тот же
// приём уже используется в ralph.js для milestones). --paginate на ответе-массиве gh
// автоматически конкатенирует все страницы в один JSON-массив, --slurp не нужен.
// `isSummary` помечает сводные обзорные тела прохода ревью (pulls/reviews[].body): они
// дублируют inline-находки того же прохода, поэтому в счёте идут в unmarked (#237).
function findingEndpoints(prNumber) {
    return [
        { endpoint: `repos/{owner}/{repo}/issues/${prNumber}/comments`, isSummary: false },
        { endpoint: `repos/{owner}/{repo}/pulls/${prNumber}/comments`, isSummary: false },
        { endpoint: `repos/{owner}/{repo}/pulls/${prNumber}/reviews`, isSummary: true },
    ];
}

// Fail-closed по образцу ghJson/security-audit: сбой gh, невалидный JSON или ответ
// неожиданной формы (не массив) — throw. Мягкого «пропустим и посчитаем как пусто» нет —
// иначе транзиентный сетевой чих превратился бы в тихо заниженную метрику.
function ghApiJsonArray(endpoint, spawnFn) {
    const r = spawnFn('gh', ['api', endpoint, '--paginate'], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    if (r.status !== 0) {
        throw new Error(
            `gh api ${endpoint} упал: ${r.stderr?.trim() || r.error?.message || `код ${r.status}`}`,
        );
    }
    let parsed;
    try {
        parsed = JSON.parse(r.stdout);
    } catch (e) {
        throw new Error(`gh api ${endpoint} вернул невалидный JSON: ${e.message}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error(
            `gh api ${endpoint} вернул не массив — формат ответа неожиданный ` +
                `(получено: ${JSON.stringify(parsed).slice(0, 200)})`,
        );
    }
    return parsed;
}

// Комментарии PR разбросаны по трём поверхностям GitHub: обычные реплики треда
// (issues/comments), inline-комментарии ревью (pulls/comments) и сводный обзорный
// комментарий каждого прохода ревью (pulls/reviews[].body) — промпт размечает меткой все
// три вида. Пустые/whitespace body (у review без сводного текста — обычное дело) отфильтрованы.
//
// #237 (ревью): фильтр по автору. Репозиторий публичный (инвариант 7 в
// .claude/ralph/CLAUDE.md), и любой прохожий, оставивший «🔴 [blocker] lol», иначе завысил
// бы счёт блокеров метрики. Если `authorAllowlist` задан непустым — учитываются только
// комментарии его авторов (`item.user.login` есть во всех трёх endpoint'ах). Пустой/не
// заданный список = без фильтрации (обратная совместимость для standalone-запуска); раннер
// всегда прокидывает cfg.authorAllowlist.
function isAllowedAuthor(item, authorAllowlist) {
    if (!Array.isArray(authorAllowlist) || authorAllowlist.length === 0) return true;
    return authorAllowlist.includes(item?.user?.login);
}

export function fetchPrComments(prNumber, { spawnFn = spawnSync, authorAllowlist = [] } = {}) {
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
        throw new Error(
            `fetchPrComments: некорректный номер PR (получено: ${JSON.stringify(prNumber)})`,
        );
    }
    const comments = [];
    for (const { endpoint, isSummary } of findingEndpoints(prNumber)) {
        const items = ghApiJsonArray(endpoint, spawnFn);
        for (const item of items) {
            if (typeof item?.body !== 'string' || !item.body.trim()) continue;
            if (!isAllowedAuthor(item, authorAllowlist)) continue;
            comments.push(isSummary ? { body: item.body, isSummary: true } : item.body);
        }
    }
    return comments;
}

export function countPrFindings(
    prNumber,
    { spawnFn = spawnSync, fetchFn = fetchPrComments, authorAllowlist = [] } = {},
) {
    const comments = fetchFn(prNumber, { spawnFn, authorAllowlist });
    return countFindingsBySeverity(comments);
}

function main() {
    const prNumber = Number(process.argv[2]);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
        console.error('⛔ review-findings: укажи номер PR первым аргументом');
        process.exit(1);
    }
    // Остальные позиционные аргументы — allowlist авторов (логины GitHub), см. #237.
    const authorAllowlist = process.argv.slice(3);
    let counts;
    try {
        counts = countPrFindings(prNumber, { authorAllowlist });
    } catch (e) {
        console.error(`⛔ review-findings: ${e.message}`);
        process.exit(1);
    }
    console.log(JSON.stringify(counts));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
