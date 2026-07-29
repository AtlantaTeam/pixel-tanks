// Сборка адаптеров ralph (#369, фаза 5) — реализации точек расширения из adapters.ts,
// подключаемые ЧЕРЕЗ КОНФИГ. adapters.ts описывает ИНТЕРФЕЙСЫ пяти швов (форж, гейт,
// нотификатор, деплой-проверка, рантайм кодер-сессии); здесь текущие боевые реализации
// оформлены как эти интерфейсы, а `buildAdapters` собирает их в единый `RalphAdapters`,
// выбирая реализацию каждого шва по ключу из `ralph.config.json` → `adapters.*`.
//
// Зачем именно так. Ядро петли (orchestrator.ts) зависит ТОЛЬКО от интерфейсов
// (`RalphAdapters`), а не от конкретных модулей: свап реализации шва = правка ключа в
// конфиге, не в коде (переносимость #204/#262). Композиция концентрируется в одной точке
// (composition root в orchestrator строит реестр реализаций и зовёт `buildAdapters`);
// конкретные модули (`gate.ts`, `deploy-check.ts`, `telegram-notifier.js`, gh-функции,
// `spawnClaude`) остаются внизу, а ядро видит только швы.
//
// Форма мапперов. Каждая `createX*Adapter` — ТОНКИЙ маппер: берёт пучок уже построенных
// боевых функций (замыкания над коллабораторами оркестратора) и раскладывает их по
// именам методов интерфейса. Значения методов — ТЕ ЖЕ ссылки на функции, поэтому
// поведение петли байт-в-байт прежнее: адаптер — типизированная группировка, не новая
// логика. Имена реализаций (`github`/`npm`/`telegram`/`github-actions`/`claude`)
// фиксируют, ЧЬЯ это реализация; фаза 6 добавит рантаймы Kimi/OpenAI тем же путём — новый
// ключ в реестре `coderRuntime`, Claude-путь не трогая.
//
// Fail-closed. Выбор шва — решение о том, ЧЕМ раннер берёт задачи и что мерджит: кривой/
// неизвестный ключ = `fail()` и стоп, не тихий дефолт (инвариант №1). `resolveAdapterSelection`
// отвергает неизвестный ключ шва и неизвестное имя реализации ДО сборки; `buildAdapters`
// повторно страхуется на отсутствии реализации в реестре.
//
// Erasable-only TypeScript без билд-шага (нативный type stripping Node ≥24): только
// `type`/аннотации, ни enum, ни namespace-рантайма. Стиль ядра — `type` без префикса `T`.

import type {
    CoderRuntimeAdapter,
    DeployCheckAdapter,
    GateAdapter,
    Issue,
    NotifierAdapter,
    PullRequest,
    RalphAdapters,
    RunOptions,
    RunResult,
    TaskSourceAdapter,
} from './adapters.ts';

// ── Дефолтные реализации швов ────────────────────────────────────────────────
// Канон текущего проекта: форж — GitHub (`gh`), гейт — npm-скрипты, нотификатор —
// Telegram, деплой-проверка — GitHub Actions + HTTP health-URL, рантайм — Claude CLI.
// Конфиг может переопределить любой ключ (`adapters.<шов>`); отсутствие ключа = дефолт.
export const ADAPTER_DEFAULTS = {
    taskSource: 'github',
    gate: 'npm',
    notifier: 'telegram',
    deployCheck: 'github-actions',
    coderRuntime: 'claude',
} as const;

// Швы в каноничном порядке — единственный источник имён (итерируется резолвером и сборкой).
export const ADAPTER_SEAMS = Object.keys(ADAPTER_DEFAULTS) as Array<keyof typeof ADAPTER_DEFAULTS>;

export type AdapterSeam = keyof typeof ADAPTER_DEFAULTS;
export type AdapterSelection = Record<AdapterSeam, string>;

// Конфиг-секция выбора реализаций (плоский конфиг ПОСЛЕ resolveProfile). Все ключи
// опциональны — отсутствующий шов берёт дефолт из ADAPTER_DEFAULTS.
export type AdapterConfig = Partial<Record<AdapterSeam, string>>;

type FailFn = (msg: string) => unknown;

// ── Резолв выбора реализаций из конфига (fail-closed) ─────────────────────────
// Возвращает ПОЛНЫЙ выбор по всем пяти швам: заданное в конфиге либо дефолт. Отвергает:
//   • неизвестный ключ шва в `adapters` (опечатка «taskSrc» молча не станет дефолтом);
//   • нестроковое/пустое имя реализации.
// Валидность имени против РЕЕСТРА (есть ли такая реализация) проверяет buildAdapters —
// у резолвера реестра нет, он знает только имена швов.
export function resolveAdapterSelection(
    adapters: AdapterConfig | undefined,
    failFn: FailFn,
): AdapterSelection {
    const sel = adapters ?? {};
    for (const key of Object.keys(sel)) {
        if (!(key in ADAPTER_DEFAULTS)) {
            failFn(
                `adapters.${key} — неизвестный шов адаптера. Допустимые: ${ADAPTER_SEAMS.join(', ')}.`,
            );
        }
    }
    const out = {} as AdapterSelection;
    for (const seam of ADAPTER_SEAMS) {
        const v = sel[seam];
        if (v === undefined) {
            out[seam] = ADAPTER_DEFAULTS[seam];
            continue;
        }
        if (typeof v !== 'string' || v.trim() === '') {
            failFn(`adapters.${seam} должен быть непустой строкой (имя реализации).`);
        }
        out[seam] = v;
    }
    return out;
}

// ── Мапперы боевых функций → типизированные адаптеры ──────────────────────────
// Каждый маппер — раскладка уже построенных функций по именам методов интерфейса. Значения
// методов — ТЕ ЖЕ ссылки (поведение прежнее). Имена методов интерфейса ≠ имена боевых
// функций (checkProdHealth → checkHealth, closeMilestoneByTitle → closeMilestone и т.п.) —
// этот сдвиг и есть работа маппера.

// Форж GitHub: issues/PR/мердж/метки/milestone/доска (orchestrator.ts + gate.ts).
export type GithubTaskSourceFns = {
    openIssues: (milestone: string) => Issue[];
    allOpenIssues: (milestone: string) => Issue[];
    findOpenPr: (branch: string) => PullRequest | null;
    phaseMerged: (phase: { branch: string }) => boolean;
    mergedPhasePr: (phase: { branch: string }) => number | null;
    mergePr: (prNumber: number, headSha?: string | null) => void;
    addBlockedLabel: (branch: string) => void;
    removeBlockedLabel: (branch: string) => void;
    closeMilestoneByTitle: (title: string) => void;
    syncProjectBoard: () => void;
};

export function createGithubTaskSource(fns: GithubTaskSourceFns): TaskSourceAdapter {
    return {
        listReadyIssues: fns.openIssues,
        listAllOpenIssues: fns.allOpenIssues,
        findOpenPullRequest: fns.findOpenPr,
        isPhaseMerged: fns.phaseMerged,
        mergedPullRequestNumber: fns.mergedPhasePr,
        mergePullRequest: fns.mergePr,
        addBlockedLabel: fns.addBlockedLabel,
        removeBlockedLabel: fns.removeBlockedLabel,
        closeMilestone: fns.closeMilestoneByTitle,
        syncBoard: fns.syncProjectBoard,
    };
}

// Гейт npm: состав чеков + прогон на точном sha PR-головы (gate.ts).
export type NpmGateFns = {
    resolveChecks: GateAdapter['resolveChecks'];
    runChecks: GateAdapter['runChecks'];
};

export function createNpmGate(fns: NpmGateFns): GateAdapter {
    return {
        resolveChecks: fns.resolveChecks,
        runChecks: fns.runChecks,
    };
}

// Нотификатор Telegram: доставка текста, fail-open (telegram-notifier.js).
export type TelegramNotifierFns = {
    notify: NotifierAdapter['notify'];
};

export function createTelegramNotifier(fns: TelegramNotifierFns): NotifierAdapter {
    return { notify: fns.notify };
}

// Деплой-проверка GitHub Actions + HTTP health (deploy-check.ts).
export type GithubActionsDeployFns = {
    mergedShaOf: DeployCheckAdapter['mergedShaOf'];
    waitForDeployRun: DeployCheckAdapter['waitForDeployRun'];
    checkProdHealth: DeployCheckAdapter['checkHealth'];
    classifyDeployOutcome: DeployCheckAdapter['classifyOutcome'];
};

export function createGithubActionsDeploy(fns: GithubActionsDeployFns): DeployCheckAdapter {
    return {
        mergedShaOf: fns.mergedShaOf,
        waitForDeployRun: fns.waitForDeployRun,
        checkHealth: fns.checkProdHealth,
        classifyOutcome: fns.classifyDeployOutcome,
    };
}

// Рантайм Claude CLI: запуск кодер-сессии → {code, output} (orchestrator.ts runClaudeOnce).
export type ClaudeRuntimeFns = {
    run: (prompt: string, options: RunOptions) => RunResult;
};

export function createClaudeRuntime(fns: ClaudeRuntimeFns): CoderRuntimeAdapter {
    return { run: fns.run };
}

// ── Сборка набора швов по выбору из конфига (fail-closed) ─────────────────────
// registries: реестр доступных реализаций по швам — { taskSource: { github: … }, … }.
// Реализаций пока по одной на шов (текущий проект); фаза 6 добавит ключи в coderRuntime.
// selection: результат resolveAdapterSelection. failFn: боевой fail (стоп раннера).
// Реализация, которой нет в реестре под выбранным ключом, = fail (тот же класс, что
// неизвестный ключ — просто ловится на слой ниже, когда реестр знает набор имён).
export type AdapterRegistries = {
    taskSource: Record<string, TaskSourceAdapter>;
    gate: Record<string, GateAdapter>;
    notifier: Record<string, NotifierAdapter>;
    deployCheck: Record<string, DeployCheckAdapter>;
    coderRuntime: Record<string, CoderRuntimeAdapter>;
};

export function buildAdapters(
    registries: AdapterRegistries,
    selection: AdapterSelection,
    failFn: FailFn,
): RalphAdapters {
    function pick<T>(seam: AdapterSeam, registry: Record<string, T>): T {
        const key = selection[seam];
        const impl = registry[key];
        if (!impl) {
            const known = Object.keys(registry);
            failFn(
                `adapters.${seam}: реализация '${key}' не зарегистрирована. ` +
                    `Доступные: ${known.length ? known.join(', ') : '(нет)'}.`,
            );
        }
        return impl;
    }
    return {
        taskSource: pick('taskSource', registries.taskSource),
        gate: pick('gate', registries.gate),
        notifier: pick('notifier', registries.notifier),
        deployCheck: pick('deployCheck', registries.deployCheck),
        coderRuntime: pick('coderRuntime', registries.coderRuntime),
    };
}
