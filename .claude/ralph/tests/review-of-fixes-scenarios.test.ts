// Приёмочные (сценарные) тесты лестницы «ревью правок» (#625) — доказательство критериев
// готовности через ВЕСЬ цикл сдачи end-to-end, а не по кускам. Образец —
// blocked-scenarios.test.ts.
//
// Юнит-уровень (дедуп, потолок, анти-пинг-понг, форма карточек) живёт в
// core/review-of-fixes.test.ts; здесь проверяется, что настоящий runLoop действительно:
//   • гоняет второй проход ПО ДИФФУ ПРАВОК даже когда блокеров не было (симптом PR #624);
//   • не продлевает цикл потоком новых minor/nit и не стопорит ими мердж;
//   • на исчерпании потолка зовёт независимого арбитра и НЕ встаёт;
//   • пишет в журнал каждый проход отдельно — «сколько дефектов нашлось в правках».
//
// Побочки запрещены (RALPH_NO_SIDE_EFFECTS=1, общий afterEach в test-setup.ts): все
// коллабораторы инжектированы фейками, ни одного реального git/gh/диска.
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — JS-entry раннера без деклараций типов (тот же приём, что в
// orchestrator.test.ts, #366): дефолт ralph.js — ре-экспорт runtime фабрики.
import ralph from '../ralph.js';
import type { RalphConfig } from '../core/orchestrator.ts';
import type { RalphState } from '../core/state-lock.ts';
import { normalizeReviewOfFixes } from '../core/review-of-fixes.ts';

type Runtime = ReturnType<typeof import('../core/orchestrator.ts').createOrchestrator>;
const runLoop = ralph.runLoop as Runtime['runLoop'];

const REVIEW_MODEL = 'claude-opus-4-8';
const ARBITER_MODEL = 'claude-fable-5';
const PR = 777;

// Маркеры диффов: по ним видно, ЧТО именно приложено к промпту прохода.
const PHASE_DIFF = '\n\nДИФФ-ФАЗЫ-ЦЕЛИКОМ';
const FIX_DIFF = '\n\nДИФФ-ТОЛЬКО-ПРАВОК';

// Промпты цикла различаем по их собственным формулировкам (prompts.ts), а не по порядку
// вызова: порядок как раз и есть предмет проверки.
const isFixReviewPrompt = (p: string) => p.includes('отревьюй ИМЕННО ЭТИ ПРАВКИ');
const isArbiterPrompt = (p: string) => p.includes('Ты независимый арбитр');
const isPhaseReviewPrompt = (p: string) => p.includes('проведи детальное code review');
const isFixPrompt = (p: string) => p.includes('Разбери замечания code review');

type Finding = { comment: string; anchor?: { path: string; line: number } };
type PassResult = { findings: Finding[]; blocked?: boolean };

const at = (line: number, path = 'src/a.ts') => ({ path, line });
const blocker = (text: string, line: number) => ({
    comment: `🔴 [blocker] ${text}`,
    anchor: at(line),
});
const major = (text: string, line: number) => ({ comment: `🟠 [major] ${text}`, anchor: at(line) });
const minor = (text: string, line: number) => ({ comment: `🟡 [minor] ${text}`, anchor: at(line) });
const nit = (text: string, line: number) => ({ comment: `⚪ [nit] ${text}`, anchor: at(line) });

const cfg = (o: Partial<RalphConfig> = {}): RalphConfig => ({
    model: 'claude-coder',
    prompt: 'сделай {milestone} в ветке {branch}',
    authorAllowlist: ['owner'],
    phases: [{ milestone: 'M1', branch: 'feature/m1' }],
    review: {
        default: REVIEW_MODEL,
        escalated: REVIEW_MODEL,
        fallback: REVIEW_MODEL,
        arbiter: ARBITER_MODEL,
        maxTurns: 80,
        backlogLabels: ['complexity:low', 'area:core', 'backlog'],
    },
    gate: { checks: [['test', 'npm run test']] },
    ...o,
});

const mkState = (o: Partial<RalphState> = {}): RalphState => ({
    count: 0,
    milestone: 'M1',
    submitted: false,
    noProgress: 0,
    gateHeals: 0,
    blockedHeals: 0,
    reviewModelFloor: null,
    lastReviewModel: null,
    reReviewPending: false,
    reviewOfFixes: null,
    deployBlock: null,
    ...o,
});

// Один прогон полного цикла сдачи. `passes` — что приносит каждый очередной проход ревью
// правок, `arbiter` — что приносит независимый арбитр. Всё остальное — нейтральные фейки.
function runPhase({
    passes = [] as PassResult[],
    arbiter = { findings: [] } as PassResult,
    gate = 'merged' as ReturnType<Runtime['tryMergePhase']>,
    config = cfg(),
    state = mkState(),
    dryRun = false,
} = {}) {
    const prompts: string[] = [];
    const logs: string[] = [];
    const models: string[] = [];
    const issues: Array<{ title: string; body: string; labels: readonly string[] }> = [];
    const journal: Array<{ pass: number; counts: Record<string, number>; pr: number | null }> = [];
    const addBlockedLabelFn = vi.fn();
    const pushEventFn = vi.fn();
    let passIdx = 0;
    let idxCalls = 0;

    runLoop(
        config,
        { state, maxIterations: 10, maxTurns: 200 },
        {
            once: false,
            dry: dryRun,
            logFn: (m: string) => logs.push(m),
            shFn: () => '',
            runArgvFn: () => '',
            saveStateFn: () => {},
            openIssuesFn: () => [],
            allOpenIssuesFn: () => [],
            hasAnyIssuesFn: () => true,
            findOpenPrFn: () => ({ number: PR, labels: [] }),
            createPrFn: () => PR,
            phasePrBodyFn: () => 'тело PR',
            getIssueFn: (number: number) => ({ number, title: 'задача', body: 'тело' }),
            prCommentsFn: () => [],
            phaseIndexOfFn: () => (idxCalls++ === 0 ? 0 : 99),
            pickModelFn: () => 'claude-coder',
            pickRuntimeFn: () => 'claude',
            pickRouteFn: () => ({ provider: 'claude', model: 'claude-coder' }),
            pickReviewModelFn: () => REVIEW_MODEL,
            phaseDiffFilesFn: () => ['src/a.ts'],
            // Дифф правок отличим от диффа фазы: у него задана база.
            reviewDiffContextFn: (_b: string, opts?: { base?: string }) =>
                opts?.base ? FIX_DIFF : PHASE_DIFF,
            branchHeadShaFn: () => 'b'.repeat(40),
            createIssueFn: (input) => {
                issues.push(input);
                return 100 + issues.length;
            },
            recordFixReviewFindingsFn: (
                _phase: unknown,
                pr: number | null,
                counts: Record<string, number>,
                pass: number,
            ) => {
                journal.push({ pass, counts, pr });
            },
            removeBlockedLabelFn: () => {},
            addBlockedLabelFn,
            runClaudeFn: (prompt: string, opts?: { model?: string }) => {
                prompts.push(prompt);
                models.push(opts?.model ?? '');
                return 0;
            },
            // Намерения применяет петля; здесь фейк отдаёт то, что «оставила» сессия.
            applySessionRequestsFn: () => {
                const last = prompts[prompts.length - 1] ?? '';
                if (isFixReviewPrompt(last)) {
                    const result = passes[passIdx] ?? { findings: [] };
                    passIdx += 1;
                    return {
                        applied: 0,
                        failed: false,
                        closedIssues: [],
                        prFindings: result.findings,
                        prBlocked: result.blocked === true,
                    };
                }
                if (isArbiterPrompt(last)) {
                    return {
                        applied: 0,
                        failed: false,
                        closedIssues: [],
                        prFindings: arbiter.findings,
                        prBlocked: arbiter.blocked === true,
                    };
                }
                return {
                    applied: 0,
                    failed: false,
                    closedIssues: [],
                    prFindings: [],
                    prBlocked: false,
                };
            },
            ensureCleanFn: () => true,
            phaseMergedFn: () => false,
            mergedPhasePrFn: () => null,
            advancePhaseFn: () => {},
            tryMergePhaseFn: () => gate,
            closeMilestoneByTitleFn: () => {},
            syncProjectBoardFn: () => {},
            recordReviewFindingsFn: () => {},
            getLastRedCheck: () => null,
            getLastGatePr: () => PR,
            pushEventFn,
            ensureMonitorAliveFn: () => null,
        },
    );

    return {
        state,
        prompts,
        logs,
        models,
        issues,
        journal,
        addBlockedLabelFn,
        pushEventFn,
        ladder: () => normalizeReviewOfFixes(state.reviewOfFixes),
        fixReviewPrompts: () => prompts.filter(isFixReviewPrompt),
        fixPrompts: () => prompts.filter(isFixPrompt),
        arbiterPrompts: () => prompts.filter(isArbiterPrompt),
        pushTexts: () => pushEventFn.mock.calls.map((c: unknown[]) => c[0] as string),
        merged: () =>
            pushEventFn.mock.calls.some((c: unknown[]) => /смерджена в main/.test(c[0] as string)),
    };
}

describe('крит. 1: фаза БЕЗ блокеров всё равно получает второй проход по диффу правок', () => {
    // Симптом PR #624: 19 находок ревью, ни одного blocker → повторного прохода не было,
    // правки уехали в main никем не прочитанными.
    it('блокеров не было → проход ревью правок всё равно состоялся, предмет — дифф правок', () => {
        const s = runPhase({ passes: [{ findings: [] }] });

        expect(s.prompts.some(isPhaseReviewPrompt)).toBe(true);
        expect(s.fixReviewPrompts()).toHaveLength(1);
        // Предмет прохода — дифф ПРАВОК, а не PR целиком.
        expect(s.fixReviewPrompts()[0]).toContain('ДИФФ-ТОЛЬКО-ПРАВОК');
        expect(s.fixReviewPrompts()[0]).not.toContain('ДИФФ-ФАЗЫ-ЦЕЛИКОМ');
        // Проход состоялся ПОСЛЕ правок, не вместо них.
        expect(s.prompts.findIndex(isFixPrompt)).toBeLessThan(
            s.prompts.findIndex(isFixReviewPrompt),
        );
        // И фаза при этом доехала до мерджа — качество не куплено остановкой петли.
        expect(s.merged()).toBe(true);
    });

    it('ревью-модель прохода не слабее планки фазы, потолок объявлен в логе', () => {
        const s = runPhase({ passes: [{ findings: [] }] });
        const idx = s.prompts.findIndex(isFixReviewPrompt);
        expect(s.models[idx]).toBe(REVIEW_MODEL);
        expect(s.logs.some((l) => /Ревью ПРАВОК \(проход 1\/3\)/.test(l))).toBe(true);
    });

    it('сессия правок ничего не изменила → проход не выдумывается, но и мердж не стопорится', () => {
        const s = runPhase({
            passes: [{ findings: [] }],
            config: cfg(),
            state: mkState(),
        });
        expect(s.fixReviewPrompts()).toHaveLength(1);
        // Отдельный прогон: дифф правок пуст.
        const empty = runPhaseWithEmptyFixDiff();
        expect(empty.fixReviewPrompts()).toHaveLength(0);
        expect(empty.logs.some((l) => /сессия правок ничего не изменила/.test(l))).toBe(true);
        expect(empty.merged()).toBe(true);
    });
});

// Отдельный прогон с пустым диффом правок: phaseDiffFiles с базой отдаёт пустой список.
function runPhaseWithEmptyFixDiff() {
    const prompts: string[] = [];
    const logs: string[] = [];
    const pushes: string[] = [];
    let idxCalls = 0;
    const state = mkState();
    runLoop(
        cfg(),
        { state, maxIterations: 10, maxTurns: 200 },
        {
            once: false,
            dry: false,
            logFn: (m: string) => logs.push(m),
            shFn: () => '',
            runArgvFn: () => '',
            saveStateFn: () => {},
            openIssuesFn: () => [],
            allOpenIssuesFn: () => [],
            hasAnyIssuesFn: () => true,
            findOpenPrFn: () => ({ number: PR, labels: [] }),
            createPrFn: () => PR,
            phasePrBodyFn: () => 'тело PR',
            getIssueFn: (number: number) => ({ number, title: 'задача', body: 'тело' }),
            prCommentsFn: () => [],
            phaseIndexOfFn: () => (idxCalls++ === 0 ? 0 : 99),
            pickModelFn: () => 'claude-coder',
            pickRuntimeFn: () => 'claude',
            pickRouteFn: () => ({ provider: 'claude', model: 'claude-coder' }),
            pickReviewModelFn: () => REVIEW_MODEL,
            phaseDiffFilesFn: (_b: string, opts?: { base?: string }) =>
                opts?.base ? [] : ['src/a.ts'],
            reviewDiffContextFn: () => PHASE_DIFF,
            branchHeadShaFn: () => 'b'.repeat(40),
            createIssueFn: () => 1,
            recordFixReviewFindingsFn: () => {},
            removeBlockedLabelFn: () => {},
            addBlockedLabelFn: () => {},
            runClaudeFn: (prompt: string) => {
                prompts.push(prompt);
                return 0;
            },
            applySessionRequestsFn: () => ({
                applied: 0,
                failed: false,
                closedIssues: [],
                prFindings: [],
                prBlocked: false,
            }),
            ensureCleanFn: () => true,
            phaseMergedFn: () => false,
            mergedPhasePrFn: () => null,
            advancePhaseFn: () => {},
            tryMergePhaseFn: () => 'merged',
            closeMilestoneByTitleFn: () => {},
            syncProjectBoardFn: () => {},
            recordReviewFindingsFn: () => {},
            getLastRedCheck: () => null,
            getLastGatePr: () => PR,
            pushEventFn: (msg: string) => {
                pushes.push(msg);
                return false;
            },
            ensureMonitorAliveFn: () => null,
        },
    );
    return {
        logs,
        fixReviewPrompts: () => prompts.filter(isFixReviewPrompt),
        merged: () => pushes.some((t) => /смерджена в main/.test(t)),
    };
}

describe('отказ git по базе диффа: проход не пропускается, а дешевеет до диффа фазы', () => {
    // Дифф правок посчитать не удалось — это НЕ «пустой дифф» и не повод пропустить
    // барьер. Проход всё равно идёт, но по диффу фазы: дороже, зато это по-прежнему
    // ревью, а не его видимость.
    it('голова ветки не прочиталась → проход идёт по диффу ФАЗЫ, с предупреждением', () => {
        const s = runPhaseWithBrokenBase({ headSha: null });
        expect(s.fixReviewPrompts()).toHaveLength(1);
        expect(s.fixReviewPrompts()[0]).toContain('ДИФФ-ФАЗЫ-ЦЕЛИКОМ');
        expect(s.logs.some((l) => /Дифф правок получить не удалось/.test(l))).toBe(true);
        expect(s.merged()).toBe(true);
    });

    it('дифф по базе не посчитался (null ≠ пусто) → тот же откат, а не «проход не нужен»', () => {
        const s = runPhaseWithBrokenBase({ headSha: 'b'.repeat(40), filesWithBase: null });
        expect(s.fixReviewPrompts()).toHaveLength(1);
        expect(s.fixReviewPrompts()[0]).toContain('ДИФФ-ФАЗЫ-ЦЕЛИКОМ');
        expect(s.logs.some((l) => /сессия правок ничего не изменила/.test(l))).toBe(false);
    });
});

function runPhaseWithBrokenBase({
    headSha,
    filesWithBase = ['src/a.ts'],
}: {
    headSha: string | null;
    filesWithBase?: string[] | null;
}) {
    const prompts: string[] = [];
    const logs: string[] = [];
    const pushes: string[] = [];
    let idxCalls = 0;
    const state = mkState();
    runLoop(
        cfg(),
        { state, maxIterations: 10, maxTurns: 200 },
        {
            once: false,
            dry: false,
            logFn: (m: string) => logs.push(m),
            shFn: () => '',
            runArgvFn: () => '',
            saveStateFn: () => {},
            openIssuesFn: () => [],
            allOpenIssuesFn: () => [],
            hasAnyIssuesFn: () => true,
            findOpenPrFn: () => ({ number: PR, labels: [] }),
            createPrFn: () => PR,
            phasePrBodyFn: () => 'тело PR',
            getIssueFn: (number: number) => ({ number, title: 'задача', body: 'тело' }),
            prCommentsFn: () => [],
            phaseIndexOfFn: () => (idxCalls++ === 0 ? 0 : 99),
            pickModelFn: () => 'claude-coder',
            pickRuntimeFn: () => 'claude',
            pickRouteFn: () => ({ provider: 'claude', model: 'claude-coder' }),
            pickReviewModelFn: () => REVIEW_MODEL,
            phaseDiffFilesFn: (_b: string, opts?: { base?: string }) =>
                opts?.base ? filesWithBase : ['src/a.ts'],
            reviewDiffContextFn: (_b: string, opts?: { base?: string }) =>
                opts?.base ? FIX_DIFF : PHASE_DIFF,
            branchHeadShaFn: () => headSha,
            createIssueFn: () => 1,
            recordFixReviewFindingsFn: () => {},
            removeBlockedLabelFn: () => {},
            addBlockedLabelFn: () => {},
            runClaudeFn: (prompt: string) => {
                prompts.push(prompt);
                return 0;
            },
            applySessionRequestsFn: () => ({
                applied: 0,
                failed: false,
                closedIssues: [],
                prFindings: [],
                prBlocked: false,
            }),
            ensureCleanFn: () => true,
            phaseMergedFn: () => false,
            mergedPhasePrFn: () => null,
            advancePhaseFn: () => {},
            tryMergePhaseFn: () => 'merged',
            closeMilestoneByTitleFn: () => {},
            syncProjectBoardFn: () => {},
            recordReviewFindingsFn: () => {},
            getLastRedCheck: () => null,
            getLastGatePr: () => PR,
            pushEventFn: (msg: string) => {
                pushes.push(msg);
                return false;
            },
            ensureMonitorAliveFn: () => null,
        },
    );
    return {
        logs,
        fixReviewPrompts: () => prompts.filter(isFixReviewPrompt),
        merged: () => pushes.some((t) => /смерджена в main/.test(t)),
    };
}

describe('крит. 2: поток новых minor/nit не продлевает цикл и не стопорит мердж', () => {
    it('пять свежих minor/nit за проход → один проход, мердж, карточки вместо задержки', () => {
        const s = runPhase({
            passes: [
                {
                    findings: [
                        minor('нейминг', 1),
                        minor('дубль', 2),
                        nit('пробел', 3),
                        nit('запятая', 4),
                        nit('порядок импортов', 5),
                    ],
                },
            ],
        });

        expect(s.fixReviewPrompts()).toHaveLength(1);
        // Потолок не сдвинулся ни на шаг: косметика цикл не продлевает.
        expect(s.ladder().passes).toBe(0);
        expect(s.merged()).toBe(true);
        // Незакрытая косметика не потеряна — она стала карточками с метками из конфига.
        expect(s.issues).toHaveLength(5);
        expect(s.issues[0].labels).toEqual(['complexity:low', 'area:core', 'backlog']);
        expect(s.issues[0].body).toContain(`PR #${String(PR)}`);
    });

    it('major держит мердж, а следующий проход с одной косметикой его отпускает', () => {
        const s = runPhase({
            passes: [
                { findings: [major('убита ветка отказа', 1), nit('пробел', 2)] },
                { findings: [nit('другой пробел', 7), minor('нейминг', 8)] },
            ],
        });

        // Два прохода: первый вернул фазу на круг правок, второй — отпустил.
        expect(s.fixReviewPrompts()).toHaveLength(2);
        expect(s.fixPrompts()).toHaveLength(2);
        // Потолок двинулся ровно один раз — от прохода с новым major.
        expect(s.ladder().passes).toBe(1);
        expect(s.merged()).toBe(true);
        // Карточки — только по косметике ПОСЛЕДНЕГО прохода: nit первого прохода ушёл в
        // круг правок вместе с major и разбирался сессией.
        expect(s.issues).toHaveLength(2);
        expect(s.issues.map((i) => i.title).join(' ')).toContain('другой пробел');
    });

    it('замечание, оспоренное дважды, становится карточкой с обеими позициями и отпускает мердж', () => {
        const same = () => blocker('спорное место', 1);
        const s = runPhase({
            passes: [{ findings: [same()] }, { findings: [same()] }, { findings: [same()] }],
        });

        expect(s.merged()).toBe(true);
        const dispute = s.issues.find((i) => i.title.startsWith('Спор ревью и правок'));
        expect(dispute).toBeDefined();
        expect(dispute?.body).toContain('Позиция ревью');
        expect(dispute?.body).toContain('Позиция правок');
        // Спор закрыт карточкой, а не третьим кругом «ревью → правки»: потолок проходов
        // не исчерпан (повтор его не двигает), арбитра звать не за чем.
        expect(s.arbiterPrompts()).toHaveLength(0);
        expect(s.ladder().passes).toBe(1);
    });
});

describe('крит. 3: три прохода с новыми major → независимый арбитр, петля не встаёт', () => {
    const threeFreshMajors = [
        { findings: [major('раз', 1)] },
        { findings: [major('два', 2)] },
        { findings: [major('три', 3)] },
    ];

    it('потолок исчерпан → арбитр сильнейшей моделью и БЕЗ истории проходов', () => {
        const s = runPhase({ passes: threeFreshMajors });

        expect(s.ladder().passes).toBe(3);
        expect(s.arbiterPrompts()).toHaveLength(1);
        expect(s.models[s.prompts.findIndex(isArbiterPrompt)]).toBe(ARBITER_MODEL);
        // «Без истории» — не фигура речи: в промпте арбитра нет ленты комментариев PR,
        // только дифф правок.
        expect(s.arbiterPrompts()[0]).toContain('ДИФФ-ТОЛЬКО-ПРАВОК');
        expect(s.arbiterPrompts()[0]).not.toContain('Комментарии ревью');
        expect(s.ladder().arbitrated).toBe(true);
    });

    it('арбитр не воспроизвёл → находки в бэклог, фаза мёржится, человека не будят', () => {
        const s = runPhase({ passes: threeFreshMajors, arbiter: { findings: [] } });

        expect(s.merged()).toBe(true);
        expect(s.addBlockedLabelFn).not.toHaveBeenCalled();
        expect(s.issues.some((i) => i.title.includes('три'))).toBe(true);
        expect(s.logs.some((l) => /блокирующего не воспроизвёл/.test(l))).toBe(true);
        // Никакого «оставлен человеку»: лестница кончается решением, а не стопом.
        expect(s.pushTexts().some((t) => /оставлен человеку|устоял/.test(t))).toBe(false);
    });

    it('арбитр воспроизвёл → label blocked и штатный разбор, а не стоп петли', () => {
        const s = runPhase({
            passes: threeFreshMajors,
            arbiter: { findings: [blocker('правка убила фичу', 9)], blocked: true },
            gate: 'blocked',
        });

        // pr-block намерения ставит метку сам applySessionRequests — раннер её не дублирует.
        expect(s.addBlockedLabelFn).not.toHaveBeenCalled();
        expect(s.pushTexts().some((t) => /арбитр подтвердил блокирующий дефект/.test(t))).toBe(
            true,
        );
        expect(s.merged()).toBe(false);
    });

    it('арбитр нашёл блокер, но метку не попросил → раннер ставит её сам (fail-closed)', () => {
        const s = runPhase({
            passes: threeFreshMajors,
            arbiter: { findings: [blocker('правка убила фичу', 9)] },
            gate: 'blocked',
        });
        expect(s.addBlockedLabelFn).toHaveBeenCalledTimes(1);
        expect(s.merged()).toBe(false);
    });
});

describe('C1: --dry-run строго read-only — лестница карточек не заводит', () => {
    it('dry: находки прохода есть, а карточка не заводится (только строка в логе)', () => {
        const s = runPhase({
            passes: [{ findings: [minor('нейминг', 1)] }],
            dryRun: true,
        });
        expect(s.issues).toHaveLength(0);
        expect(
            s.logs.some((l) => /DRY: карточка по замечанию ревью правок не заводится/.test(l)),
        ).toBe(true);
    });
});

describe('крит. 4: журнал находок различает проходы', () => {
    it('каждый проход — своя запись с номером прохода и счётом СВЕЖИХ находок', () => {
        const s = runPhase({
            passes: [
                { findings: [major('раз', 1), nit('мелочь', 2)] },
                { findings: [blocker('два', 3)] },
                { findings: [] },
            ],
        });

        expect(s.journal.map((e) => e.pass)).toEqual([1, 2, 3]);
        expect(s.journal[0].counts).toMatchObject({ major: 1, nit: 1, total: 2 });
        expect(s.journal[1].counts).toMatchObject({ blocker: 1, total: 1 });
        expect(s.journal[2].counts).toMatchObject({ total: 0 });
        expect(s.journal.every((e) => e.pr === PR)).toBe(true);
    });

    it('повторное замечание в счёт прохода не идёт — иначе спор выглядел бы новой работой', () => {
        const s = runPhase({
            passes: [
                { findings: [blocker('одно и то же', 1)] },
                { findings: [blocker('одно и то же', 1)] },
            ],
        });
        expect(s.journal[0].counts.total).toBe(1);
        expect(s.journal[1].counts.total).toBe(0);
    });
});
