// Контрактный сьют интерфейсов адаптеров (#370, трек «Фреймворк ralph», фаза 5).
//
// Отличие от соседних тестов:
//   - adapters.test.ts (#262) доказывает, что интерфейсы РЕАЛИЗУЕМЫ — фейками;
//   - adapters-impl.test.ts (#369) проверяет СБОРКУ (мапперы, resolveAdapterSelection,
//     buildAdapters) — тоже фейками;
//   - здесь — ОДИН и тот же набор поведенческих ассертов на интерфейс прогоняется
//     против ДВУХ реализаций подряд: минимального in-memory фейка (realizability) и
//     БОЕВОЙ логики текущих адаптеров (gate.ts/deploy-check.ts/telegram-notifier.ts/
//     orchestrator.ts) с подменённым на границе I/O (sh/ghJson/execFn/spawnFn — то же
//     DI, что и в gate.test.ts/deploy-check.test.ts/telegram-notifier.test.ts).
//   Так проверяется именно КОНТРАКТ: свойство держится независимо от того, кто за
//   интерфейсом стоит — ручной фейк или реальный npm/GitHub/Telegram/Claude-адаптер.
//
// Известное ограничение (см. комментарий у buildRealTaskSource): `openIssues`/
// `allOpenIssues` (orchestrator.ts) не имеют собственного DI-хука на чтение gh (в
// отличие от соседних findOpenPr/closeMilestoneByTitle) — их вызывает только runLoop
// через параметр `openIssuesFn`. Поэтому «боевая» реализация TaskSourceAdapter здесь
// покрывает боевым кодом 8 из 10 методов интерфейса (findOpenPullRequest/isPhaseMerged/
// mergedPullRequestNumber/mergePullRequest/addBlockedLabel/removeBlockedLabel/
// closeMilestone/syncBoard), а listReadyIssues/listAllOpenIssues — тем же фейком, что и
// в realizability-флейворе (честно закомментировано на месте, не выдаётся за боевую
// логику).
import { describe, expect, it, vi } from 'vitest';
import type {
    CoderRuntimeAdapter,
    DeployCheckAdapter,
    GateAdapter,
    GateCheckResult,
    Issue,
    NotifierAdapter,
    PullRequest,
    RunResult,
    TaskSourceAdapter,
} from '../adapters/adapters.ts';
import {
    createCoderRuntime,
    createGithubActionsDeploy,
    createGithubTaskSource,
    createNpmGate,
    createTelegramNotifier,
} from '../adapters/adapters-impl.ts';
import type { GateEnv } from '../core/gate.ts';
import { createGateRunner } from '../core/gate.ts';
import type { DeployCheckEnv } from '../core/deploy-check.ts';
import { createDeployCheckModule } from '../core/deploy-check.ts';
// Боевой POSIX-квотер без побочек — тот же, что импортируют соседние тесты; локальная
// копия молча разъехалась бы с ним при правке экранирования.
import { shq } from '../shared/ralph-util.ts';
import { sendTelegramMessage } from '../runtime/telegram-notifier.ts';
// @ts-expect-error — JS-entry раннера без деклараций типов (тот же приём, что gate.test.ts
// и deploy-check.test.ts): findOpenPr/closeMilestoneByTitle/syncProjectBoard/buildClaudeArgs/
// spawnClaude живут только на боевой поверхности ralph.js.
import ralph from '../ralph.js';

const SHA = 'a'.repeat(40);

// ── Синтетические env боевых фабрик (реальная логика, фейковый I/O) ──────────────────

function makeGateEnv(over: Partial<GateEnv> = {}): GateEnv {
    return {
        sh: () => {
            throw new Error('sh не подменён в тесте');
        },
        shArgv: () => {
            throw new Error('shArgv не подменён в тесте');
        },
        shq,
        log: () => {},
        fail: (msg: string) => {
            throw new Error(msg);
        },
        getConfig: () => ({ gate: { checks: [['test', 'npm run test']] } }),
        ghJson: () => {
            throw new Error('ghJson не подменён в тесте');
        },
        safeBranch: () => true,
        findOpenPr: () => null,
        ensureClean: () => true,
        parkOnOriginMain: () => {},
        updateRunnerTreeToOriginMain: () => {},
        syncDepsIfLockChanged: () => {},
        buildSanitizedGateEnv: () => ({}),
        formatExcerpt: (s: string) => s,
        sleep: () => {},
        dry: false,
        SHA40_RE: /^[0-9a-f]{40}$/,
        PR_NUMBER_RE: /^\d+$/,
        runnerTreeFixHint: 'git fetch origin main && git checkout --detach origin/main',
        ...over,
    };
}

function makeDeployEnv(over: Partial<DeployCheckEnv> = {}): DeployCheckEnv {
    return {
        getConfig: () => ({}),
        ghJson: () => {
            throw new Error('ghJson не подменён в тесте');
        },
        shq,
        log: () => {},
        sleep: () => {},
        guardSideEffect: (what: string) => {
            throw new Error(`побочка без override в тесте: ${what}`);
        },
        positiveIntOrDefault: (value: unknown, dflt: number) =>
            typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : dflt,
        SHA40_RE: /^[0-9a-f]{40}$/,
        ...over,
    };
}

// ── TaskSourceAdapter ────────────────────────────────────────────────────────────────

const MILESTONE = 'Фаза X';
const BRANCH = 'feature/x';

const ISSUES: Issue[] = [
    { number: 30, title: 'третий', author: { login: 'ok-author' } },
    { number: 10, title: 'первый', author: { login: 'ok-author' } },
    { number: 20, title: 'blocked', labels: [{ name: 'blocked' }], author: { login: 'ok-author' } },
    { number: 5, title: 'чужой автор', author: { login: 'stranger' } },
];
const ALLOWLIST = ['ok-author'];

// Общий фильтр «готовые issues» — используется ОБОИМИ флейворами для listReadyIssues/
// listAllOpenIssues, так как ни одна боевая реализация не даёт независимого DI-хука на
// чтение gh для этих двух методов (см. докблок файла). Не боевой код — синтетический
// эквивалент того же контракта, что описан в adapters.ts.
function filterReady(issues: Issue[]): Issue[] {
    return issues
        .filter((i) => !(i.labels ?? []).some((l) => l.name === 'blocked'))
        .filter((i) => ALLOWLIST.includes(i.author?.login ?? ''))
        .slice()
        .sort((a, b) => a.number - b.number);
}

function buildFakeTaskSource(): { adapter: TaskSourceAdapter; calls: string[] } {
    const calls: string[] = [];
    const prs: Record<string, PullRequest | null> = { [BRANCH]: null };
    const merged: Record<string, number | null> = {};
    let allOpenThrows = false;
    const adapter: TaskSourceAdapter = {
        listReadyIssues: (milestone) => (milestone === MILESTONE ? filterReady(ISSUES) : []),
        listAllOpenIssues: (milestone) => {
            if (allOpenThrows) throw new Error('gh issue list упал');
            return milestone === MILESTONE ? ISSUES.slice() : [];
        },
        findOpenPullRequest: (branch) => prs[branch] ?? null,
        isPhaseMerged: (phase) => (merged[phase.branch] ?? null) !== null,
        mergedPullRequestNumber: (phase) => merged[phase.branch] ?? null,
        mergePullRequest: (prNumber, headSha) => {
            calls.push(`merge:${prNumber}:${headSha ?? '-'}`);
        },
        addBlockedLabel: (branch) => calls.push(`block+:${branch}`),
        removeBlockedLabel: (branch) => calls.push(`block-:${branch}`),
        closeMilestone: (title) => calls.push(`close-ms:${title}`),
        syncBoard: () => calls.push('sync-board'),
    };
    // Тест-хук фейка (не часть контракта) — включить fail-closed сценарий.
    (adapter as unknown as { __setAllOpenThrows: (v: boolean) => void }).__setAllOpenThrows = (
        v: boolean,
    ) => {
        allOpenThrows = v;
    };
    (adapter as unknown as { __setPr: (branch: string, pr: PullRequest | null) => void }).__setPr =
        (branch: string, pr: PullRequest | null) => {
            prs[branch] = pr;
        };
    return { adapter, calls };
}

// Боевая реализация: findOpenPr/closeMilestoneByTitle/syncProjectBoard — прямая ссылка на
// ralph.js (единственное место, где они живут); phaseMerged/mergedPhasePr/mergePr/
// addBlockedLabel/removeBlockedLabel — СВЕЖИЙ createGateRunner(fakeEnv), не зависящий от
// синглтона ralph.js (та же логика, что gate.ts реально исполняет в бою). listReadyIssues/
// listAllOpenIssues — см. докблок файла, тем же фейком, что и realizability-флейвор.
// Собираем адаптер ИМЕННО через боевой маппер createGithubTaskSource(adapters-impl.ts) —
// тогда под контрактом оказывается и сам сдвиг имён (openIssues→listReadyIssues и т.п.),
// а не только функции под ним.
function buildRealTaskSource(): { adapter: TaskSourceAdapter; gateEnv: GateEnv } {
    let ghJsonImpl: (cmd: string) => unknown = () => {
        throw new Error('ghJson не подменён в тесте (gate)');
    };
    const shArgvCalls: string[] = [];
    const gateEnv = makeGateEnv({
        ghJson: ((cmd: string) => ghJsonImpl(cmd)) as GateEnv['ghJson'],
        shArgv: (file, args) => {
            shArgvCalls.push(`${file} ${args.join(' ')}`);
            return '';
        },
        // Эти пути читают gh через ghJson, не sh; sh-стаб просто нейтрален.
        sh: () => '',
    });
    const g = createGateRunner(gateEnv);

    let allOpenThrows = false;
    const adapter: TaskSourceAdapter = createGithubTaskSource({
        openIssues: (milestone) => (milestone === MILESTONE ? filterReady(ISSUES) : []),
        allOpenIssues: (milestone) => {
            if (allOpenThrows) throw new Error('gh issue list упал');
            return milestone === MILESTONE ? ISSUES.slice() : [];
        },
        findOpenPr: (branch: string): PullRequest | null =>
            ralph.findOpenPr(branch, {
                ghJsonFn: (cmd: string) => ghJsonImpl(cmd),
                logFn: () => {},
            }),
        phaseMerged: g.phaseMerged,
        mergedPhasePr: g.mergedPhasePr,
        mergePr: (prNumber: number, headSha?: string | null) => g.mergePr(prNumber, headSha),
        addBlockedLabel: (branch: string) => g.addBlockedLabel(branch),
        removeBlockedLabel: (branch: string) => g.removeBlockedLabel(branch),
        closeMilestoneByTitle: (title: string) =>
            ralph.closeMilestoneByTitle(title, {
                ghJsonFn: (cmd: string) => ghJsonImpl(cmd),
                runArgvFn: (file: string, args: string[]) => {
                    shArgvCalls.push(`${file} ${args.join(' ')}`);
                    return '';
                },
                logFn: () => {},
            }),
        syncProjectBoard: () =>
            ralph.syncProjectBoard(
                (file: string, args: string[]) => {
                    shArgvCalls.push(`${file} ${args.join(' ')}`);
                    return 'ok — синк доски (0 карточек)';
                },
                () => {},
            ),
    });
    // Тест-хук: подменить ghJson-диспетчер сценария (разные тесты — разные фикстуры gh).
    (adapter as unknown as { __setGhJson: (fn: (cmd: string) => unknown) => void }).__setGhJson = (
        fn,
    ) => {
        ghJsonImpl = fn;
    };
    (adapter as unknown as { __setAllOpenThrows: (v: boolean) => void }).__setAllOpenThrows = (
        v: boolean,
    ) => {
        allOpenThrows = v;
    };
    (adapter as unknown as { __shArgvCalls: () => string[] }).__shArgvCalls = () => shArgvCalls;
    return { adapter, gateEnv };
}

type TaskSourceHook = {
    __setGhJson?: (fn: (cmd: string) => unknown) => void;
    __setAllOpenThrows: (v: boolean) => void;
    __setPr?: (branch: string, pr: PullRequest | null) => void;
    __shArgvCalls?: () => string[];
};

function registerTaskSourceContract(
    label: string,
    build: () => { adapter: TaskSourceAdapter },
): void {
    describe(`TaskSourceAdapter — ${label}`, () => {
        it('listReadyIssues отдаёт готовые issues отсортированными, без blocked и чужих авторов', () => {
            const { adapter } = build();
            expect(adapter.listReadyIssues(MILESTONE).map((i) => i.number)).toEqual([10, 30]);
        });

        it('listAllOpenIssues НЕ фильтрует (C2: blocked и чужие тоже считаются)', () => {
            const { adapter } = build();
            expect(adapter.listAllOpenIssues(MILESTONE)).toHaveLength(4);
        });

        it('НЕГАТИВНЫЙ: listAllOpenIssues fail-closed — бросает при сбое форжа', () => {
            const { adapter } = build();
            (adapter as unknown as TaskSourceHook).__setAllOpenThrows(true);
            expect(() => adapter.listAllOpenIssues(MILESTONE)).toThrow();
        });

        it('findOpenPullRequest: PR найден → возвращает его', () => {
            const { adapter } = build();
            const hook = adapter as unknown as TaskSourceHook;
            if (hook.__setGhJson) {
                hook.__setGhJson((cmd) => {
                    if (cmd.includes('gh pr list --head')) return [{ number: 9, labels: [] }];
                    throw new Error(`unexpected: ${cmd}`);
                });
            } else if (hook.__setPr) {
                hook.__setPr(BRANCH, { number: 9, labels: [] });
            }
            expect(adapter.findOpenPullRequest(BRANCH)).toEqual({ number: 9, labels: [] });
        });

        it('findOpenPullRequest: PR нет → null', () => {
            const { adapter } = build();
            expect(adapter.findOpenPullRequest('feature/none')).toBeNull();
        });

        it('НЕГАТИВНЫЙ: findOpenPullRequest — неоднозначность (>1 открытый PR) → null, не гадаем', () => {
            const { adapter } = build();
            const hook = adapter as unknown as TaskSourceHook;
            if (!hook.__setGhJson) return; // фейк-флейвор не моделирует множественность отдельно
            hook.__setGhJson((cmd) => {
                if (cmd.includes('gh pr list --head'))
                    return [
                        { number: 9, labels: [] },
                        { number: 10, labels: [] },
                    ];
                throw new Error(`unexpected: ${cmd}`);
            });
            expect(adapter.findOpenPullRequest(BRANCH)).toBeNull();
        });

        it('mergePullRequest прокидывает sha головы (для --match-head-commit) и не бросает', () => {
            const { adapter } = build();
            const hook = adapter as unknown as TaskSourceHook;
            expect(() => adapter.mergePullRequest(42, SHA)).not.toThrow();
            // Боевой флейвор: проверяем не только «не бросает», а что sha реально уехал в
            // argv `gh pr merge` через --match-head-commit — то самое TOCTOU-свойство
            // контракта. Фейк argv не моделирует, для него достаточно not.toThrow выше.
            if (hook.__shArgvCalls) {
                const mergeArgv = hook.__shArgvCalls().find((c) => c.includes('pr merge'));
                expect(mergeArgv).toContain(`--match-head-commit ${SHA}`);
            }
        });

        it('НЕГАТИВНЫЙ: mergePullRequest без валидного sha — мердж БЕЗ --match-head-commit', () => {
            const { adapter } = build();
            const hook = adapter as unknown as TaskSourceHook;
            if (!hook.__shArgvCalls) return; // ветку SHA40_RE моделирует только боевой argv
            expect(() => adapter.mergePullRequest(42, '')).not.toThrow();
            const mergeArgv = hook.__shArgvCalls().find((c) => c.includes('pr merge'));
            expect(mergeArgv).toBeDefined();
            expect(mergeArgv).not.toContain('--match-head-commit');
        });

        it('addBlockedLabel/removeBlockedLabel/closeMilestone/syncBoard не бросают (fail-open)', () => {
            const { adapter } = build();
            const hook = adapter as unknown as TaskSourceHook;
            hook.__setGhJson?.((cmd) => {
                if (cmd.includes('milestones?state=open')) return [];
                throw new Error(`unexpected: ${cmd}`);
            });
            expect(() => adapter.addBlockedLabel(BRANCH)).not.toThrow();
            expect(() => adapter.removeBlockedLabel(BRANCH)).not.toThrow();
            expect(() => adapter.closeMilestone(MILESTONE)).not.toThrow();
            expect(() => adapter.syncBoard()).not.toThrow();
        });
    });
}

registerTaskSourceContract('фейк (in-memory)', buildFakeTaskSource);
registerTaskSourceContract('боевая логика (gate.ts + ralph.js DI)', buildRealTaskSource);

// ── GateAdapter ──────────────────────────────────────────────────────────────────────

function buildFakeGate(passing: Set<string>): GateAdapter {
    const base: Array<[string, string]> = [
        ['lint', 'npm run lint'],
        ['test', 'npm run test'],
    ];
    return {
        resolveChecks: (profileName) =>
            profileName === 'prod' ? [...base, ['e2e', 'npm run e2e']] : [...base],
        runChecks: (branch, prNumber) => {
            const red = base.find(([, cmd]) => !passing.has(cmd));
            if (red) {
                return {
                    green: false,
                    verifiedHead: null,
                    redCheck: { name: red[0], cmd: red[1], excerpt: 'fail' },
                };
            }
            return { green: true, verifiedHead: `sha-${branch}-${prNumber}`, redCheck: null };
        },
    };
}

// Боевая логика: createGateRunner(fakeEnv) — та же checksGreen/gateChecksFor, что реально
// гоняет гейт мерджа; runChecks собирает GateCheckResult ровно как orchestrator.ts::gateRunChecks
// (composition root, #369) — это НЕ новая логика, а тот же приём сведения boolean+геттеров в
// один объект вердикта.
function buildRealGate(passing: Set<string>): GateAdapter {
    const checks: Array<[string, string]> = [
        ['lint', 'npm run lint'],
        ['test', 'npm run test'],
    ];
    const gateEnv = makeGateEnv({
        getConfig: () => ({
            gate: { checks, prodChecks: [['e2e', 'npm run e2e']], prodDropChecks: [] },
        }),
        ghJson: (() => ({ headRefOid: SHA })) as GateEnv['ghJson'],
        shArgv: () => '',
        sh: (cmd) => {
            if (cmd.includes('rev-parse')) return ''; // без локальной ветки — путь H3 не участвует
            if (passing.has(cmd)) return 'ok';
            const e = new Error('красный чек') as Error & { stdout?: string; stderr?: string };
            e.stderr = `${cmd} упал`;
            throw e;
        },
    });
    const g = createGateRunner(gateEnv);
    function runChecks(branch: string, prNumber: number): GateCheckResult {
        const green = g.checksGreen(branch, prNumber, { checks: g.gateChecksFor() });
        if (green) return { green: true, verifiedHead: g.getVerifiedHead(), redCheck: null };
        return {
            green: false,
            verifiedHead: null,
            redCheck: g.getLastRedCheck() ?? {
                name: 'gate',
                cmd: 'checksGreen',
                excerpt: 'гейт упал до чеков',
            },
        };
    }
    return createNpmGate({ resolveChecks: g.gateChecksFor, runChecks });
}

function registerGateContract(label: string, build: (passing: Set<string>) => GateAdapter): void {
    describe(`GateAdapter — ${label}`, () => {
        it('resolveChecks добавляет толстые чеки в профиле prod', () => {
            const gate = build(new Set());
            expect(gate.resolveChecks(undefined).map(([n]) => n)).toEqual(['lint', 'test']);
            expect(gate.resolveChecks('prod').map(([n]) => n)).toEqual(['lint', 'test', 'e2e']);
        });

        it('runChecks зелёный: green=true, verifiedHead задан, redCheck=null', () => {
            const gate = build(new Set(['npm run lint', 'npm run test']));
            const res = gate.runChecks(BRANCH, 9);
            expect(res.green).toBe(true);
            expect(res.verifiedHead).not.toBeNull();
            expect(res.redCheck).toBeNull();
        });

        it('НЕГАТИВНЫЙ: runChecks красный — green=false, verifiedHead=null, redCheck заполнен именем чека', () => {
            const gate = build(new Set(['npm run lint'])); // test красный
            const res = gate.runChecks(BRANCH, 9);
            expect(res.green).toBe(false);
            expect(res.verifiedHead).toBeNull();
            expect(res.redCheck?.name).toBe('test');
        });
    });
}

registerGateContract('фейк (in-memory)', buildFakeGate);
registerGateContract('боевая логика (gate.ts, createGateRunner)', buildRealGate);

// ── NotifierAdapter ──────────────────────────────────────────────────────────────────

function buildFakeNotifier(fail: boolean): { adapter: NotifierAdapter; sent: string[] } {
    const sent: string[] = [];
    return {
        sent,
        adapter: {
            notify: (text) => {
                if (fail) return false;
                sent.push(text);
                return true;
            },
        },
    };
}

// Боевая логика: sendTelegramMessage реальный (telegram-notifier.ts), execFn подменён —
// та же граница DI, что telegram-notifier.test.ts.
function buildRealNotifier(fail: boolean): { adapter: NotifierAdapter; sent: string[] } {
    const sent: string[] = [];
    const execFn = (_file: string, args: string[]): string => {
        if (fail) {
            throw new Error('Command failed: curl …');
        }
        // --data-urlencode text=<...> — вытащим отправленный текст для ассерта.
        const textArg = args.find((a) => a.startsWith('text='));
        sent.push(textArg ? decodeURIComponent(textArg.slice('text='.length)) : '');
        return '{"ok":true}';
    };
    return {
        sent,
        adapter: createTelegramNotifier({
            notify: (text: string) =>
                sendTelegramMessage(text, {
                    token: '123:abc',
                    chatId: '42',
                    execFn,
                    logFn: () => {},
                    sleepFn: () => {},
                    attempts: 1,
                }),
        }),
    };
}

function registerNotifierContract(
    label: string,
    build: (fail: boolean) => { adapter: NotifierAdapter; sent: string[] },
): void {
    describe(`NotifierAdapter — ${label}`, () => {
        it('доставляет текст и возвращает true', () => {
            const { adapter, sent } = build(false);
            expect(adapter.notify('привет')).toBe(true);
            expect(sent).toEqual(['привет']);
        });

        it('НЕГАТИВНЫЙ: при сбое доставки возвращает false и НЕ бросает (fail-open по определению)', () => {
            const { adapter } = build(true);
            expect(() => adapter.notify('падение доставки')).not.toThrow();
            expect(adapter.notify('падение доставки')).toBe(false);
        });
    });
}

registerNotifierContract('фейк (in-memory)', buildFakeNotifier);
registerNotifierContract(
    'боевая логика (telegram-notifier.ts, execFn подменён)',
    buildRealNotifier,
);

// ── DeployCheckAdapter ───────────────────────────────────────────────────────────────

function buildFakeDeployCheck(): DeployCheckAdapter {
    return {
        mergedShaOf: (prNumber) => {
            throw new Error(`нет sha мерджа для PR ${prNumber}`);
        },
        waitForDeployRun: (sha) => ({
            status: 'not-found',
            conclusion: null,
            sha,
            url: null,
            runId: null,
        }),
        checkHealth: () => ({ ok: false, status: 0, url: '', reason: 'config' }),
        classifyOutcome: (outcome, health) => {
            const green =
                !!outcome && outcome.status === 'completed' && outcome.conclusion === 'success';
            if (!green) return { red: true, reason: 'workflow не зелёный' };
            if (health && health.ok === false) return { red: true, reason: 'прод не отвечает' };
            return { red: false, reason: 'ok' };
        },
    };
}

// Боевая логика: createDeployCheckModule(fakeEnv) — та же ghJson-фикстура и execFn-подмена,
// что deploy-check.test.ts.
function buildRealDeployCheck(opts: { healthUrl?: string } = {}): DeployCheckAdapter {
    const cfg = { deployCheck: { healthUrl: opts.healthUrl ?? '' } };
    const dc = createDeployCheckModule(
        makeDeployEnv({
            getConfig: () => cfg,
            ghJson: () => {
                throw new Error('mergeCommit не резолвится (нет sha)');
            },
        }),
    );
    return createGithubActionsDeploy({
        mergedShaOf: (prNumber: number) =>
            dc.mergedShaOf(prNumber, { attempts: 1, sleepFn: () => {} }),
        waitForDeployRun: dc.waitForDeployRun,
        checkProdHealth: () =>
            dc.checkProdHealth(cfg, {
                execFn: () => {
                    throw new Error('curl не должен звать сеть в этом тесте');
                },
                sleepFn: () => {},
                logFn: () => {},
            }),
        classifyDeployOutcome: dc.classifyDeployOutcome,
    });
}

function registerDeployCheckContract(
    label: string,
    build: (opts?: { healthUrl?: string }) => DeployCheckAdapter,
): void {
    describe(`DeployCheckAdapter — ${label}`, () => {
        const green = {
            status: 'completed' as const,
            conclusion: 'success',
            sha: 'b'.repeat(40),
            url: 'https://ci.test/run/1',
            runId: 1,
        };

        it('GREEN только при зелёном workflow И здоровом проде', () => {
            const dc = build();
            expect(dc.classifyOutcome(green, { ok: true, status: 200, url: 'u' }).red).toBe(false);
        });

        it('красный при незелёном workflow', () => {
            const dc = build();
            const timeout = {
                status: 'timeout' as const,
                conclusion: null,
                sha: green.sha,
                url: null,
                runId: null,
            };
            expect(dc.classifyOutcome(timeout, { ok: true, status: 200, url: 'u' }).red).toBe(true);
        });

        it('НЕГАТИВНЫЙ: mergedShaOf fail-closed — бросает, когда sha не резолвится', () => {
            const dc = build();
            expect(() => dc.mergedShaOf(5)).toThrow();
        });

        it('НЕГАТИВНЫЙ: checkHealth reason:"config" при незаданном healthUrl (не путаем с «прод упал»)', () => {
            const dc = build({ healthUrl: '' });
            const health = dc.checkHealth();
            expect(health.ok).toBe(false);
            expect(health.reason).toBe('config');
        });
    });
}

registerDeployCheckContract('фейк (in-memory)', buildFakeDeployCheck);
registerDeployCheckContract(
    'боевая логика (deploy-check.ts, createDeployCheckModule)',
    buildRealDeployCheck,
);

// ── CoderRuntimeAdapter ──────────────────────────────────────────────────────────────

function buildFakeRuntime(result: { code: number; output: string }): CoderRuntimeAdapter {
    return createCoderRuntime({ run: () => ({ code: result.code, output: result.output }) });
}

// Боевая логика: buildClaudeArgs + spawnClaude (ralph.js), spawnFn подменён — та же граница
// DI, что и в orchestrator.test.ts (явная инъекция, НЕ vi.mock('node:child_process')).
function buildRealRuntime(spawnResult: {
    status: number | null;
    stdout: string;
    stderr: string;
    signal?: string | null;
}): CoderRuntimeAdapter {
    const spawnFn = vi.fn(() => spawnResult);
    return createCoderRuntime({
        run: (prompt: string, options): RunResult => {
            const argv = ralph.buildClaudeArgs(prompt, options, {});
            return ralph.spawnClaude(argv, 1000, spawnFn);
        },
    });
}

function registerCoderRuntimeContract(
    label: string,
    buildOk: () => CoderRuntimeAdapter,
    buildFail: () => CoderRuntimeAdapter,
    buildKilled: () => CoderRuntimeAdapter,
): void {
    describe(`CoderRuntimeAdapter — ${label}`, () => {
        it('run возвращает код и объединённый вывод при успехе', () => {
            const adapter = buildOk();
            const res = adapter.run('почини баг', { maxTurns: 40 });
            expect(res.code).toBe(0);
        });

        it('НЕГАТИВНЫЙ: ненулевой код процесса не бросает — просто отражается в code', () => {
            const adapter = buildFail();
            expect(() => adapter.run('задача', { maxTurns: 10 })).not.toThrow();
            expect(adapter.run('задача', { maxTurns: 10 }).code).not.toBe(0);
        });

        it('НЕГАТИВНЫЙ: процесс убит по сигналу (таймаут) → code:1, не бросает', () => {
            const adapter = buildKilled();
            const res = adapter.run('задача', { maxTurns: 10 });
            expect(res.code).toBe(1);
        });
    });
}

registerCoderRuntimeContract(
    'фейк (in-memory)',
    () => buildFakeRuntime({ code: 0, output: 'готово' }),
    () => buildFakeRuntime({ code: 2, output: 'boom' }),
    () => buildFakeRuntime({ code: 1, output: 'killed' }),
);
registerCoderRuntimeContract(
    'боевая логика (buildClaudeArgs + spawnClaude, spawnFn подменён)',
    () => buildRealRuntime({ status: 0, stdout: 'готово', stderr: '' }),
    () => buildRealRuntime({ status: 2, stdout: '', stderr: 'boom' }),
    () => buildRealRuntime({ status: null, stdout: '', stderr: '', signal: 'SIGTERM' }),
);
