// Общая тест-обвязка для тестов deadman/monitor (#Ov3). Раньше приватный tmp-каталог,
// writeLog/mkTmp, cleanup в afterEach/afterAll и хелпер t() (ISO-префикс строки лога)
// были продублированы почти дословно в трёх тест-файлах. Здесь — один источник: формат
// строки лога и жизненный цикл временного файла меняются в одном месте.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { runLoop } from './ralph.js';

// Строка лога как её пишет log() в ralph.js — ISO-таймстамп + маркер. Таймстамп
// фиксированный: тесты задают «сейчас» через mtime + ageMs, сам префикс роли не играет.
export function logLine(msg) {
    return `[2026-07-22T06:30:07.015Z] ${msg}`;
}

// Фабрика временных лог-файлов на диске (как боевой ralph.log). Приватный каталог через
// mkdtemp: иначе имена в общем os.tmpdir() детерминированы и два параллельных прогона
// vitest (гейт раннера в своём worktree + человек в своём) писали бы и unlink'али одни
// файлы → флак. Возвращает writeLog() (строки или готовый контент) и cleanup-функции для
// afterEach (файлы) и afterAll (каталог).
export function makeTmpLog(prefix) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const tmpFiles = [];
    function writeLog(linesOrContent) {
        const content = Array.isArray(linesOrContent) ? linesOrContent.join('\n') : linesOrContent;
        const p = path.join(tmpDir, `log-${tmpFiles.length}-${content.length}.log`);
        fs.writeFileSync(p, content);
        tmpFiles.push(p);
        return p;
    }
    function cleanupFiles() {
        while (tmpFiles.length) {
            try {
                fs.unlinkSync(tmpFiles.pop());
            } catch {
                /* ignore */
            }
        }
    }
    function removeDir() {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    }
    return { tmpDir, writeLog, cleanupFiles, removeDir };
}

// ── Оркестратор сценарного прогона гейта (#223, было дублем в blocked-/hold-scenarios) ──
// Модель ревью, поставившего блок (по ней встаёт планка #217), и лимит разбора blocked.
export const SCENARIO_REVIEW_MODEL = 'claude-opus-4-8';
export const SCENARIO_B_MAX = 3;

// state сдачи: сессии кодера позади (submitted=true) — каждый проход стартует прямо с
// гейта. lastReviewModel — модель, поставившая блок.
const scenarioState = (o = {}) => ({
    count: 0,
    milestone: 'M1',
    submitted: true,
    noProgress: 0,
    gateHeals: 0,
    blockedHeals: 0,
    lastReviewModel: SCENARIO_REVIEW_MODEL,
    ...o,
});

// Профиль НЕ prod: merged завершается continue (мердж — финал). blockedHealAttempts=3.
const scenarioCfg = (o = {}) => ({
    model: 'claude-coder',
    prompt: 'сделай {milestone} в ветке {branch}',
    authorAllowlist: ['owner'],
    blockedHealAttempts: SCENARIO_B_MAX,
    phases: [{ milestone: 'M1', branch: 'feature/m1' }],
    ...o,
});

// Общий оркестратор сценарных тестов гейта для blocked-scenarios и hold-scenarios: один
// state, кумулятивные спаи, pass(gate,{redCheck}) = один проход раннера с заданным
// вердиктом гейта. phaseIndexOfFn отдаёт валидный индекс на 1-м обращении и «за концом»
// на 2-м, поэтому каждый проход упирается в break — ровно как настоящий while-цикл
// переоценивает гейт на следующем витке. restart() пересобирает state из последнего
// saveState-снимка («раннер убит и поднят, state прочитан с диска»). Все побочки —
// фейки через DI (RALPH_NO_SIDE_EFFECTS=1, guardSideEffect): ни одного реального gh/сети.
// Спаи возвращаются объектом — правку сигнатуры deps runLoop синхронизируем здесь одним
// местом, оба тест-файла оставляют только свои describe.
export function makeRunLoopScenario(initialState = {}, { lastGatePr = 777 } = {}) {
    const logs = [];
    const saved = [];
    const runClaudeFn = vi.fn(() => 0);
    const pushEventFn = vi.fn();
    const removeBlockedLabelFn = vi.fn();
    const addBlockedLabelFn = vi.fn();
    let state = scenarioState(initialState);

    function pass(gate, { redCheck = null } = {}) {
        let idxCalls = 0;
        runLoop(
            scenarioCfg(),
            { state, maxIterations: 10, maxTurns: 200 },
            {
                once: false,
                dry: false,
                logFn: (m) => logs.push(m),
                shFn: () => '',
                saveStateFn: (s) => saved.push({ ...s }),
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseIndexOfFn: () => (idxCalls++ === 0 ? 0 : 99),
                pickModelFn: () => 'claude-coder',
                pickReviewModelFn: () => SCENARIO_REVIEW_MODEL,
                reviewDiffContextFn: () => '',
                phaseDiffFilesFn: () => [],
                removeBlockedLabelFn,
                addBlockedLabelFn,
                runClaudeFn,
                ensureCleanFn: () => true,
                phaseMergedFn: () => false,
                advancePhaseFn: () => {},
                tryMergePhaseFn: () => gate,
                closeMilestoneByTitleFn: () => {},
                syncProjectBoardFn: () => {},
                recordReviewFindingsFn: () => {},
                getLastRedCheck: () => redCheck,
                getLastGatePr: () => lastGatePr,
                pushEventFn,
                ensureMonitorAliveFn: () => null,
            },
        );
    }

    function restart() {
        state = { ...saved[saved.length - 1] };
        return state;
    }

    return {
        get state() {
            return state;
        },
        pass,
        restart,
        logs,
        saved,
        runClaudeFn,
        pushEventFn,
        removeBlockedLabelFn,
        addBlockedLabelFn,
        pushTexts: () => pushEventFn.mock.calls.map((c) => c[0]),
        maxBlockedHeals: () => Math.max(0, ...saved.map((s) => s.blockedHeals ?? 0)),
    };
}
