#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

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
export function countFindingsBySeverity(comments) {
    const counts = { blocker: 0, major: 0, minor: 0, nit: 0, unmarked: 0, total: 0 };
    for (const comment of comments) {
        const body = typeof comment === 'string' ? comment : comment?.body;
        const severity = parseSeverity(body);
        if (severity) counts[severity] += 1;
        else counts.unmarked += 1;
        counts.total += 1;
    }
    return counts;
}

// {owner}/{repo} — плейсхолдеры gh api, подставляет сам gh по текущему репозиторию (тот же
// приём уже используется в ralph.js для milestones). --paginate на ответе-массиве gh
// автоматически конкатенирует все страницы в один JSON-массив, --slurp не нужен.
function findingEndpoints(prNumber) {
    return [
        `repos/{owner}/{repo}/issues/${prNumber}/comments`,
        `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
        `repos/{owner}/{repo}/pulls/${prNumber}/reviews`,
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
export function fetchPrComments(prNumber, { spawnFn = spawnSync } = {}) {
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
        throw new Error(
            `fetchPrComments: некорректный номер PR (получено: ${JSON.stringify(prNumber)})`,
        );
    }
    const bodies = [];
    for (const endpoint of findingEndpoints(prNumber)) {
        const items = ghApiJsonArray(endpoint, spawnFn);
        for (const item of items) {
            if (typeof item?.body === 'string' && item.body.trim()) bodies.push(item.body);
        }
    }
    return bodies;
}

export function countPrFindings(prNumber, { spawnFn = spawnSync, fetchFn = fetchPrComments } = {}) {
    const comments = fetchFn(prNumber, { spawnFn });
    return countFindingsBySeverity(comments);
}

function main() {
    const prNumber = Number(process.argv[2]);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
        console.error('⛔ review-findings: укажи номер PR первым аргументом');
        process.exit(1);
    }
    let counts;
    try {
        counts = countPrFindings(prNumber);
    } catch (e) {
        console.error(`⛔ review-findings: ${e.message}`);
        process.exit(1);
    }
    console.log(JSON.stringify(counts));
}

if (import.meta.filename === process.argv[1]) main();
