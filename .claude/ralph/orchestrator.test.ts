// Тесты контракта «оркестратор + тонкий entry» (#365, трек «Фреймворк ralph», фаза 3).
//
// Суть распила: вся логика петли живёт в orchestrator.ts (фабрика createOrchestrator,
// собирающая остальные модули), а ralph.js — только entry: проверка Node, парсинг
// CLI-флагов, запуск main() и ре-экспорт API для тестов/монитора. Эти тесты — барьер
// от регрессии распила: «тонкость» entry и полнота API проверяются детерминированно,
// а не на слово (принцип «барьеры важнее промптов», инвариант №5).
//
// Правило GIT_DIR-hazard: тесты НЕ трогают живой git — только чтение файлов исходников
// и сборка фабрики с фейковыми коллабораторами (RALPH_NO_SIDE_EFFECTS=1 отсекает
// побочки боевых дефолтов, общий afterEach в test-setup.js сверяет журнал).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createOrchestrator } from './orchestrator.ts';

// process.cwd(), а не import.meta: под nodenext-tsconfig ralph .ts-файлы — CJS
// (TS1470 на import.meta), а vitest гоняет тесты из корня репо — путь стабилен.
const RALPH_JS = path.join(process.cwd(), '.claude', 'ralph', 'ralph.js');

// Боевые флаги по умолчанию — как у vitest-процесса без CLI-флагов раннера.
const FLAGS_OFF = {
    once: false,
    dry: false,
    reset: false,
    resubmit: false,
    deployResolved: false,
};

// Минимальные внешние JS-коллабораторы (мост из entry): фейки вместо
// telegram-notifier/gate-env, чтобы сборка фабрики не тянула сеть/env.
function buildRuntime(flags = FLAGS_OFF, argv: string[] = []) {
    return createOrchestrator({
        argv,
        flags,
        external: {
            sendTelegramMessage: () => false,
            telegramConfigFromEnv: () => ({ token: '', chatId: '' }),
            buildSanitizedGateEnv: () => ({}),
        },
    });
}

describe('createOrchestrator: API-поверхность', () => {
    // Поверхность module.exports ralph.js — контракт: на ней сидят ralph.test.js,
    // сценарные тесты и monitor.js (resolveProfile/parseProfileFlag/pushEvent/shq).
    // Пропавший ключ = молча сломанный тест или монитор.
    const REQUIRED_API = [
        // config-слой
        'resolveProfile',
        'deepMerge',
        'parseProfileFlag',
        // монитор
        'startMonitor',
        'stopMonitor',
        'adoptMonitor',
        'processAlive',
        'cmdlineIncludes',
        'isMonitorProcess',
        'isRalphMonitorProcess',
        'listMonitorPids',
        'processPpid',
        'sweepOrphanMonitors',
        'ensureMonitorAlive',
        // lock/state
        'isRalphProcess',
        'lockAlive',
        'writeLock',
        'removeLock',
        'releaseLockIfOurs',
        'acquireLock',
        'acquireRunnerLock',
        'loadState',
        'lockHash',
        'syncDepsIfLockChanged',
        // claude-сессия
        'buildClaudeArgs',
        'spawnClaude',
        'runClaude',
        // примитивы исполнения (#138)
        'shq',
        'sh',
        'shArgv',
        'log',
        'sideEffectAttempts',
        // milestones/доска
        'closeCompletedMilestones',
        'closeMilestoneByTitle',
        'syncProjectBoard',
        // ревью
        'recordReviewFindings',
        'pickReviewModel',
        'pickReviewFallbackModel',
        'reviewModelRank',
        'strongerReviewModel',
        'removeBlockedLabel',
        'addBlockedLabel',
        'phaseDiffFiles',
        'reviewDiffContext',
        'globToRegExp',
        'matchRiskPaths',
        'sliceWholeChars',
        'formatExcerpt',
        // api-limit
        'parseResetWaitMs',
        'apiLimitWaitMs',
        'apiLimitMessage',
        'minutesOrDefault',
        'positiveIntOrDefault',
        'API_LIMIT_RE',
        // туннель/пуши
        'tunnelHealthy',
        'ensureTunnel',
        'tunnelCheckEnabled',
        'pushEvent',
        'probeEgress',
        'restartTunnel',
        // worktree
        'resolveWorktreePath',
        'parseWorktreeList',
        'refreshRunnerWorktree',
        'runnerWorktreeReady',
        'ensureRunnerWorktree',
        // петля/гейт
        'preflight',
        'runLoop',
        'ensureClean',
        'parkOnOriginMain',
        'safeBranch',
        'gateChecksFor',
        'checksGreen',
        'findOpenPr',
        'tryMergePhase',
        'getLastRedCheck',
        'getVerifiedHead',
        'getLastGatePr',
        // деплой-проверка
        'deployPhasePlaceholder',
        'mergedShaOf',
        'deployWaitMessage',
        'waitForDeployRun',
        'probeHttpStatus',
        'checkProdHealth',
        'isWorkflowGreen',
        'classifyDeployOutcome',
        // entry-запуск
        'main',
    ];

    it('возвращает все ключи прежнего module.exports ralph.js (плюс main)', () => {
        const runtime = buildRuntime();
        const missing = REQUIRED_API.filter(
            (key) => (runtime as Record<string, unknown>)[key] === undefined,
        );
        expect(missing).toEqual([]);
    });

    it('сборка фабрики — чистая: не запускает петлю и не трогает процесс', () => {
        // Если бы сборка дёргала git/gh/claude, боевые дефолты упали бы guardSideEffect
        // (RALPH_NO_SIDE_EFFECTS=1) — общий afterEach сверяет журнал. Здесь достаточно,
        // что фабрика собралась и вернула функции, не бросив.
        const runtime = buildRuntime();
        expect(typeof runtime.main).toBe('function');
        expect(typeof runtime.runLoop).toBe('function');
    });

    it('ре-экспорт ralph.js отдаёт тот же контракт (import не запускает main)', async () => {
        // import сам по себе — проверка «main не запущен»: запуск main() из тестового
        // процесса упал бы на guardSideEffect/acquireLock или ушёл в process.exit.
        // @ts-expect-error — JS-entry без деклараций типов; контракт сверяем по ключам.
        const ralph = (await import('./ralph.js')) as { default: Record<string, unknown> };
        const missing = REQUIRED_API.filter((key) => ralph.default[key] === undefined);
        expect(missing).toEqual([]);
    });
});

describe('createOrchestrator: флаги CLI', () => {
    it('dry: acquireRunnerLock не берёт лок вовсе (C1 read-only)', () => {
        const runtime = buildRuntime({ ...FLAGS_OFF, dry: true });
        let called = 0;
        // acquireLockFn не должен быть вызван: dry-прогон лок не проверяет и не пишет.
        const ok = runtime.acquireRunnerLock({
            acquireLockFn: () => {
                called++;
                return true;
            },
        });
        expect(ok).toBe(true);
        expect(called).toBe(0);
    });

    it('без dry: acquireRunnerLock зовёт acquireLock', () => {
        const runtime = buildRuntime();
        let called = 0;
        runtime.acquireRunnerLock({
            acquireLockFn: () => {
                called++;
                return true;
            },
        });
        expect(called).toBe(1);
    });
});

describe('ralph.js: тонкий entry (храповик распила #365)', () => {
    const source = fs.readFileSync(RALPH_JS, 'utf-8');

    it('entry короче 200 строк — монолит не возвращается', () => {
        // До распила ralph.js держал 2990 строк. Порог с запасом на комментарии:
        // рост выше — признак, что логика снова оседает в entry, а не в модулях.
        expect(source.split('\n').length).toBeLessThan(200);
    });

    it('в entry нет петли и гейта — только парсинг флагов и запуск', () => {
        // Маркеры монолитной логики, которых в тонком entry быть не должно.
        expect(source).not.toMatch(/while \(true\)/);
        expect(source).not.toMatch(/execSync|spawnSync\(/);
        expect(source).not.toMatch(/tryMergePhase|checksGreen|runLoop\s*\(/);
    });

    it('entry парсит все пять флагов режима и --profile', () => {
        for (const flag of ['--once', '--dry-run', '--reset', '--resubmit', '--deploy-resolved']) {
            expect(source).toContain(`'${flag}'`);
        }
        // --profile парсится в main() оркестратора из argv, entry обязан его передать.
        expect(source).toMatch(/argv/);
    });
});
