#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countPrFindings, SEVERITY_LEVELS } from './review-findings.mjs';

// #169: журнал находок по фазам с разметкой источника («ревью слабеет/крепнет» — число,
// не ощущение, PRD `docs/ralph-reliability/prd.md` п.4).
//
// Формат и место (решение этого issue, пункт критериев готовности):
// - JSONL, ОДНА запись — одна строка, рядом с остальными ralph-рантайм-файлами
//   (ralph.log, ralph.state.json — та же папка, тот же принцип: живёт в worktree
//   раннера, не в git). Причина не коммитить в main тем же путём, что код фазы:
//   раннер (см. .claude/ralph/CLAUDE.md) НИГДЕ не коммитит в main напрямую — только
//   squash-мердж уже отревьюенных PR. Заводить для журнала прямой пуш в main —
//   отдельный небезопасный класс мутации, которого в кодовой базе нет вовсе; JSONL
//   в гитигноренном рантайм-каталоге даёт то же самое «человек читает утром» (RUNBOOK,
//   тот же приём, что и с ralph.log) без нового класса риска.
// - JSON построчно, а не единый JSON-массив: не читать и не парсить целиком, чтобы
//   дописать одну запись (важно при росте журнала на протяжении многих фаз), и повреждение
//   хвоста при обрыве процесса не портит уже записанные строки.
//
// Путь — АБСОЛЮТНЫЙ (#237): раньше был относительным и резолвился от cwd, из-за чего две
// половины метрики расходились по разным файлам. Авто-половина: ralph.js делает
// process.chdir(worktreePath), запись уходила в journal дерева раннера. Ручная половина:
// человек по RUNBOOK живёт в своём checkout'е и, запустив record-found-after оттуда, писал
// в СВОЙ файл — «утром видно только половину находок» по причине cwd. Дефолт теперь
// якорится к каталогу модуля (не к cwd), а `RALPH_REVIEW_FINDINGS_JOURNAL` — общий knob,
// которым раннер и человек делят один абсолютный путь к journal'у дерева раннера.
const DEFAULT_JOURNAL_PATH = fileURLToPath(
    new URL('../.claude/ralph/review-findings.jsonl', import.meta.url),
);
export const JOURNAL_PATH = process.env.RALPH_REVIEW_FINDINGS_JOURNAL || DEFAULT_JOURNAL_PATH;

// review-loop — автоматизированная половина (счёт по меткам severity в комментариях PR,
// #168). found-after — ручная половина (#170): находки, всплывшие уже после мерджа фазы.
// review-of-fixes (#625) — счёт ОТДЕЛЬНОГО прохода ревью ПРАВОК: без него журнал знает
// только «сколько находок было у фазы» и не отвечает на вопрос, ради которого лестница
// заведена, — сколько дефектов нашлось именно в правках по ревью. Такие записи несут поле
// `pass` (номер круга), а counts приходят посчитанными снаружи: считать «все комментарии
// PR» здесь нечем — проход виден только петле, которая знает, что в нём нового.
export const JOURNAL_SOURCES = ['review-loop', 'found-after', 'review-of-fixes'];

// Выводим из SEVERITY_LEVELS (#237), а не дублируем список руками: добавишь новую severity
// в review-findings.mjs — валидация журнала подхватит её же ключ, записи не разъедутся.
const COUNT_KEYS = [...SEVERITY_LEVELS, 'unmarked', 'total'];

// Fail-closed по образцу countFindingsBySeverity/fetchPrComments: битая запись не должна
// молча уйти строкой в журнал — тогда метрика однажды соврёт числом, а не просто пропуском.
function assertValidCounts(counts) {
    if (!counts || typeof counts !== 'object') {
        throw new Error(`counts обязан быть объектом (получено: ${JSON.stringify(counts)})`);
    }
    for (const key of COUNT_KEYS) {
        if (!Number.isInteger(counts[key]) || counts[key] < 0) {
            throw new Error(
                `counts.${key} обязан быть неотрицательным целым (получено: ${JSON.stringify(counts[key])})`,
            );
        }
    }
    // #237: инвариант total === сумма частей. Без него каллер, передавший рассогласованный
    // total (напр. total: 40 при 3 находках), прошёл бы проверку и метрика соврала бы ровно
    // тем числом, ради честности которого журнал и заведён.
    const sum = SEVERITY_LEVELS.reduce((acc, key) => acc + counts[key], 0) + counts.unmarked;
    if (counts.total !== sum) {
        throw new Error(
            `counts.total (${counts.total}) обязан равняться сумме частей ` +
                `blocker+major+minor+nit+unmarked (${sum})`,
        );
    }
}

function assertValidEntry({ milestone, source, pr, pass, counts }) {
    if (typeof milestone !== 'string' || !milestone.trim()) {
        throw new Error(
            `milestone обязан быть непустой строкой (получено: ${JSON.stringify(milestone)})`,
        );
    }
    if (!JOURNAL_SOURCES.includes(source)) {
        throw new Error(
            `source обязан быть одним из ${JOURNAL_SOURCES.join('/')} (получено: ${JSON.stringify(source)})`,
        );
    }
    if (pr !== null && pr !== undefined && (!Number.isInteger(pr) || pr <= 0)) {
        throw new Error(
            `pr обязан быть положительным целым или null (получено: ${JSON.stringify(pr)})`,
        );
    }
    // #625: номер прохода. null/отсутствие — запись не про отдельный проход (обе прежние
    // половины метрики). Валидируется той же строгостью, что pr: «pass: 0» или «pass: '2'»
    // прошли бы молча и различали бы проходы неверно — то есть метрика соврала бы числом.
    if (pass !== null && pass !== undefined && (!Number.isInteger(pass) || pass <= 0)) {
        throw new Error(
            `pass обязан быть положительным целым или null (получено: ${JSON.stringify(pass)})`,
        );
    }
    assertValidCounts(counts);
}

// Предохранитель #138: это первая в scripts/ дефолтная побочка-ЗАПИСЬ на диск. Тест,
// забывший инжектировать writeFn, иначе молча дописал бы строку в настоящий journal (общий
// afterEach ловит только ralph.js/telegram-notifier). Дефолт под RALPH_NO_SIDE_EFFECTS=1
// кидает — тот же барьер, что guardSideEffect у ralph.js (#237).
function guardedAppendFileSync(path, data) {
    if (process.env.RALPH_NO_SIDE_EFFECTS === '1') {
        throw new Error(
            `RALPH_NO_SIDE_EFFECTS=1: запись в journal (${path}) заблокирована — ` +
                `тест обязан инжектировать writeFn`,
        );
    }
    return appendFileSync(path, data);
}

// Одна строка журнала = один вызов = одна запись. pr необязателен (found-after может
// не привязываться к конкретному PR — находка после мерджа фазы, а не в её ревью).
export function appendJournalEntry(
    { milestone, source, pr = null, pass = null, counts },
    {
        journalPath = JOURNAL_PATH,
        writeFn = guardedAppendFileSync,
        nowFn = () => new Date().toISOString(),
    } = {},
) {
    assertValidEntry({ milestone, source, pr, pass, counts });
    const entry = { ts: nowFn(), milestone, source, pr, pass, counts };
    writeFn(journalPath, `${JSON.stringify(entry)}\n`);
    return entry;
}

// Автоматизированная половина метрики целиком: считает находки PR по severity (#168) и
// пишет запись source=review-loop. Зовёт это runLoop раннера ПОСЛЕ того, как tryMergePhase
// вернул 'merged' (ralph.js, ветка gate === 'merged'), — сам tryMergePhase журнал не
// трогает: «по завершении фазы в журнале есть запись со счётом находок ревью петли».
// `authorAllowlist` (#237) прокидывается в счёт: считаем только комментарии доверенных
// авторов, репозиторий публичный.
export function recordReviewLoopFindings(
    prNumber,
    milestone,
    {
        countFn = countPrFindings,
        appendFn = appendJournalEntry,
        authorAllowlist = [],
        journalPath,
        nowFn,
    } = {},
) {
    const counts = countFn(prNumber, { authorAllowlist });
    return appendFn(
        { milestone, source: 'review-loop', pr: prNumber, counts },
        { journalPath, nowFn },
    );
}

// #625: запись об ОТДЕЛЬНОМ проходе ревью правок. counts приходят готовыми, а не считаются
// здесь: «что нашлось именно в этом проходе» знает только петля — она держит дедуп находок
// между кругами, а лента комментариев PR к этому моменту содержит все проходы разом.
export function recordFixReviewFindings(
    prNumber,
    milestone,
    counts,
    { pass = null, appendFn = appendJournalEntry, journalPath, nowFn } = {},
) {
    return appendFn(
        { milestone, source: 'review-of-fixes', pr: prNumber, pass, counts },
        { journalPath, nowFn },
    );
}

// Разбор именованных флагов CLI (#625). Позиционные аргументы остаются прежними
// (`<pr> <milestone> [авторы…]`) — иначе прежние вызовы (раннер, RUNBOOK, рука человека)
// сломались бы молча.
function parseFlags(argv) {
    const flags = {};
    const positional = [];
    for (const arg of argv) {
        const m = /^--([a-z-]+)=([\s\S]*)$/.exec(arg);
        if (m) flags[m[1]] = m[2];
        else positional.push(arg);
    }
    return { flags, positional };
}

function main() {
    const { flags, positional } = parseFlags(process.argv.slice(2));
    const prNumber = Number(positional[0]);
    const milestone = positional[1];
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
        console.error('⛔ review-findings-journal: укажи номер PR первым аргументом');
        process.exit(1);
    }
    if (typeof milestone !== 'string' || !milestone.trim()) {
        console.error('⛔ review-findings-journal: укажи milestone вторым аргументом');
        process.exit(1);
    }
    // Остальные позиционные аргументы — allowlist авторов (логины GitHub), см. #237.
    const authorAllowlist = positional.slice(2);
    let entry;
    try {
        if (flags.counts !== undefined) {
            // Готовый счёт → запись о проходе ревью правок. Разбор fail-closed: кривой JSON
            // в argv не должен уехать в журнал «как есть» — метрика соврала бы числом.
            let counts;
            try {
                counts = JSON.parse(flags.counts);
            } catch (e) {
                throw new Error(`--counts не разобрался как JSON: ${e.message}`);
            }
            const pass = flags.pass === undefined ? null : Number(flags.pass);
            entry = recordFixReviewFindings(prNumber, milestone, counts, { pass });
        } else {
            entry = recordReviewLoopFindings(prNumber, milestone, { authorAllowlist });
        }
    } catch (e) {
        console.error(`⛔ review-findings-journal: ${e.message}`);
        process.exit(1);
    }
    console.log(JSON.stringify(entry));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
