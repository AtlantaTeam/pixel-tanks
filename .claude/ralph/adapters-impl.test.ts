// Тесты сборки адаптеров (#369): резолв выбора из конфига (fail-closed), мапперы боевых
// функций в методы интерфейсов (сдвиг имён — работа маппера) и buildAdapters (выбор по
// конфигу + fail на незарегистрированной реализации). Это НЕ контрактный сьют против
// боевых модулей (#370) — здесь фейки; проверяем именно ЛОГИКУ сборки и выбора.
import { describe, expect, it, vi } from 'vitest';
import type {
    CoderRuntimeAdapter,
    DeployCheckAdapter,
    GateAdapter,
    NotifierAdapter,
    TaskSourceAdapter,
} from './adapters.ts';
import {
    ADAPTER_DEFAULTS,
    ADAPTER_SEAMS,
    buildAdapters,
    createCoderRuntime,
    createGithubActionsDeploy,
    createGithubTaskSource,
    createNpmGate,
    createTelegramNotifier,
    resolveAdapterSelection,
    type AdapterRegistries,
} from './adapters-impl.ts';

// fail, который бросает (боевой уходит в process.exit) — чтобы тест увидел стоп.
function throwingFail(msg: string): never {
    throw new Error(msg);
}

// --- resolveAdapterSelection --------------------------------------------------

describe('resolveAdapterSelection — выбор реализаций из конфига (fail-closed)', () => {
    it('пустой/отсутствующий конфиг → полный дефолт по всем швам', () => {
        expect(resolveAdapterSelection(undefined, throwingFail)).toEqual(ADAPTER_DEFAULTS);
        expect(resolveAdapterSelection({}, throwingFail)).toEqual(ADAPTER_DEFAULTS);
    });

    it('заданный шов переопределяет дефолт, остальные остаются дефолтными', () => {
        const sel = resolveAdapterSelection({ coderRuntime: 'kimi' }, throwingFail);
        expect(sel.coderRuntime).toBe('kimi');
        expect(sel.taskSource).toBe(ADAPTER_DEFAULTS.taskSource);
        expect(sel.gate).toBe(ADAPTER_DEFAULTS.gate);
    });

    it('неизвестный ключ шва → fail (опечатка не уходит в тихий дефолт)', () => {
        expect(() => resolveAdapterSelection({ taskSrc: 'github' } as never, throwingFail)).toThrow(
            /неизвестный шов/,
        );
    });

    it('нестроковое или пустое имя реализации → fail', () => {
        expect(() => resolveAdapterSelection({ gate: '' }, throwingFail)).toThrow(
            /непустой строкой/,
        );
        expect(() => resolveAdapterSelection({ gate: '   ' }, throwingFail)).toThrow(
            /непустой строкой/,
        );
        expect(() => resolveAdapterSelection({ gate: 7 as never }, throwingFail)).toThrow(
            /непустой строкой/,
        );
    });

    it('ADAPTER_SEAMS перечисляет ровно ключи ADAPTER_DEFAULTS', () => {
        expect([...ADAPTER_SEAMS].sort()).toEqual(Object.keys(ADAPTER_DEFAULTS).sort());
    });
});

// --- Мапперы: боевые функции → имена методов интерфейса -----------------------

describe('createGithubTaskSource — раскладка функций форжа по методам интерфейса', () => {
    it('методы интерфейса зовут соответствующие боевые функции (сдвиг имён)', () => {
        const calls: string[] = [];
        const spy =
            (name: string, ret?: unknown) =>
            (...args: unknown[]) => {
                calls.push(`${name}:${JSON.stringify(args)}`);
                return ret;
            };
        const ts: TaskSourceAdapter = createGithubTaskSource({
            openIssues: spy('openIssues', []) as never,
            allOpenIssues: spy('allOpenIssues', []) as never,
            findOpenPr: spy('findOpenPr', null) as never,
            phaseMerged: spy('phaseMerged', true) as never,
            mergedPhasePr: spy('mergedPhasePr', 42) as never,
            mergePr: spy('mergePr') as never,
            addBlockedLabel: spy('addBlockedLabel') as never,
            removeBlockedLabel: spy('removeBlockedLabel') as never,
            closeMilestoneByTitle: spy('closeMilestoneByTitle') as never,
            syncProjectBoard: spy('syncProjectBoard') as never,
        });
        ts.listReadyIssues('MS');
        ts.listAllOpenIssues('MS');
        ts.findOpenPullRequest('feature/x');
        expect(ts.isPhaseMerged({ branch: 'feature/x' })).toBe(true);
        expect(ts.mergedPullRequestNumber({ branch: 'feature/x' })).toBe(42);
        ts.mergePullRequest(7, 'a'.repeat(40));
        ts.addBlockedLabel('feature/x');
        ts.removeBlockedLabel('feature/x');
        ts.closeMilestone('MS');
        ts.syncBoard();
        expect(calls).toEqual([
            'openIssues:["MS"]',
            'allOpenIssues:["MS"]',
            'findOpenPr:["feature/x"]',
            'phaseMerged:[{"branch":"feature/x"}]',
            'mergedPhasePr:[{"branch":"feature/x"}]',
            `mergePr:[7,"${'a'.repeat(40)}"]`,
            'addBlockedLabel:["feature/x"]',
            'removeBlockedLabel:["feature/x"]',
            'closeMilestoneByTitle:["MS"]',
            'syncProjectBoard:[]',
        ]);
    });
});

describe('createGithubActionsDeploy — сдвиг имён checkProdHealth→checkHealth и т.п.', () => {
    it('checkHealth зовёт checkProdHealth, classifyOutcome — classifyDeployOutcome', () => {
        const checkProdHealth = vi.fn(() => ({ ok: true, status: 200, url: 'u' }));
        const classifyDeployOutcome = vi.fn(() => ({ red: false, reason: 'ok' }));
        const mergedShaOf = vi.fn(() => 'b'.repeat(40));
        const waitForDeployRun = vi.fn(() => ({
            status: 'completed' as const,
            conclusion: 'success',
            sha: 'b'.repeat(40),
            url: null,
            runId: 1,
        }));
        const dc: DeployCheckAdapter = createGithubActionsDeploy({
            mergedShaOf,
            waitForDeployRun,
            checkProdHealth,
            classifyDeployOutcome,
        });
        expect(dc.checkHealth().ok).toBe(true);
        expect(checkProdHealth).toHaveBeenCalledTimes(1);
        dc.classifyOutcome(null, null);
        expect(classifyDeployOutcome).toHaveBeenCalledWith(null, null);
        expect(dc.mergedShaOf(9)).toBe('b'.repeat(40));
        expect(dc.waitForDeployRun('b'.repeat(40)).conclusion).toBe('success');
    });
});

describe('мапперы гейта / нотификатора / рантайма', () => {
    it('createNpmGate раскладывает resolveChecks/runChecks', () => {
        const resolveChecks = vi.fn(() => [['lint', 'npm run lint']] as [string, string][]);
        const runChecks = vi.fn(() => ({ green: true, verifiedHead: 'h', redCheck: null }));
        const g: GateAdapter = createNpmGate({ resolveChecks, runChecks });
        expect(g.resolveChecks('prod')).toEqual([['lint', 'npm run lint']]);
        expect(g.runChecks('feature/x', 3).green).toBe(true);
    });

    it('createTelegramNotifier раскладывает notify (fail-open передаётся как есть)', () => {
        const notify = vi.fn(() => false);
        const n: NotifierAdapter = createTelegramNotifier({ notify });
        expect(n.notify('текст')).toBe(false);
        expect(notify).toHaveBeenCalledWith('текст');
    });

    // #373/#374: один конструктор на все провайдеры кодер-рантайма (claude/kimi/openai) —
    // контракт шва идентичен, провайдер-специфика живёт в боевой функции `run`, а читаемость
    // намерения даёт КЛЮЧ реестра, не имя конструктора.
    it('createCoderRuntime раскладывает run (общий на claude/kimi/openai)', () => {
        const run = vi.fn(() => ({ code: 0, output: 'diff' }));
        const r: CoderRuntimeAdapter = createCoderRuntime({ run });
        expect(r.run('промпт', { maxTurns: 10 })).toEqual({ code: 0, output: 'diff' });
        expect(run).toHaveBeenCalledWith('промпт', { maxTurns: 10 });
    });
});

// --- buildAdapters ------------------------------------------------------------

function fakeRegistries(): AdapterRegistries {
    const ts: TaskSourceAdapter = createGithubTaskSource({
        openIssues: () => [],
        allOpenIssues: () => [],
        findOpenPr: () => null,
        phaseMerged: () => false,
        mergedPhasePr: () => null,
        mergePr: () => {},
        addBlockedLabel: () => {},
        removeBlockedLabel: () => {},
        closeMilestoneByTitle: () => {},
        syncProjectBoard: () => {},
    });
    const gate: GateAdapter = createNpmGate({
        resolveChecks: () => [],
        runChecks: () => ({ green: true, verifiedHead: 'h', redCheck: null }),
    });
    const notifier: NotifierAdapter = createTelegramNotifier({ notify: () => true });
    const deployCheck: DeployCheckAdapter = createGithubActionsDeploy({
        mergedShaOf: () => 'sha',
        waitForDeployRun: () => ({
            status: 'not-found',
            conclusion: null,
            sha: 'sha',
            url: null,
            runId: null,
        }),
        checkProdHealth: () => ({ ok: true, status: 200, url: 'u' }),
        classifyDeployOutcome: () => ({ red: false, reason: 'ok' }),
    });
    const coderRuntime: CoderRuntimeAdapter = createCoderRuntime({
        run: () => ({ code: 0, output: '' }),
    });
    return {
        taskSource: { github: ts },
        gate: { npm: gate },
        notifier: { telegram: notifier },
        deployCheck: { 'github-actions': deployCheck },
        coderRuntime: { claude: coderRuntime },
    };
}

describe('buildAdapters — сборка набора швов по выбору из конфига', () => {
    it('дефолтный выбор собирает все пять швов из реестра', () => {
        const reg = fakeRegistries();
        const sel = resolveAdapterSelection(undefined, throwingFail);
        const adapters = buildAdapters(reg, sel, throwingFail);
        expect(Object.keys(adapters).sort()).toEqual(
            ['coderRuntime', 'deployCheck', 'gate', 'notifier', 'taskSource'].sort(),
        );
        // Выбранная реализация — ТА САМАЯ ссылка из реестра, а не копия.
        expect(adapters.taskSource).toBe(reg.taskSource.github);
        expect(adapters.gate).toBe(reg.gate.npm);
        expect(adapters.gate.runChecks('b', 1).green).toBe(true);
    });

    it('выбирает реализацию по ключу селекции, а не первую попавшуюся', () => {
        const reg = fakeRegistries();
        const secondRuntime: CoderRuntimeAdapter = createCoderRuntime({
            run: () => ({ code: 7, output: 'kimi' }),
        });
        reg.coderRuntime.kimi = secondRuntime;
        const sel = resolveAdapterSelection({ coderRuntime: 'kimi' }, throwingFail);
        const adapters = buildAdapters(reg, sel, throwingFail);
        expect(adapters.coderRuntime.run('p', { maxTurns: 1 }).output).toBe('kimi');
    });

    it('незарегистрированная реализация выбранного ключа → fail (не тихий undefined-шов)', () => {
        const reg = fakeRegistries();
        const sel = resolveAdapterSelection({ notifier: 'slack' }, throwingFail);
        expect(() => buildAdapters(reg, sel, throwingFail)).toThrow(
            /notifier.*'slack'.*не зарегистрирована/,
        );
    });
});
