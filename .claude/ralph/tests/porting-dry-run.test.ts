// #371: трек «Фреймворк ralph», фаза 5. Переносимость (#204) доказывается не только
// статическим грепом (core-purity.test.ts — ловит проектные строки В КОДЕ ядра), но и
// поведением: ядро должно инициализироваться и спланировать фазу на конфиге ЧУЖОГО
// проекта (другие имена доски/гейта/URL/фаз/промпта/роутинга моделей), не подглядывая
// в pixel-tanks дефолты. Фикстура — `__fixtures__/foreign-project/ralph.config.json`,
// её значения намеренно ни разу не пересекаются со значениями боевого
// `ralph.config.json` (кроме имён моделей ревью — те часть словаря ядра, не проекта,
// см. REVIEW_MODEL_STRENGTH в review.ts).
//
// createOrchestrator зовётся НАПРЯМУЮ (как в orchestrator.test.ts, блок «createOrchestrator:
// API-поверхность»), а не через singleton ralph.js — так фикстурный прогон получает
// независимый config/adapters и не делит состояние с остальным сьютом.
//
// «Без реального Claude/GitHub» обеспечено структурно: RALPH_NO_SIDE_EFFECTS=1 (vitest-
// проект ralph, см. vitest.config.ts) заставляет боевые sh/shArgv/spawnClaude падать через
// guardSideEffect (#138), если их не подменить явно. Каждый DI-параметр preflight/runLoop,
// который может дойти до git/gh/claude в dry-режиме, подменён фейком — забытый дефолт
// (в т.ч. адаптерский, `adapters.taskSource.*`) либо бросит на построении фабрики, либо
// попадёт в общий журнал sideEffectAttempts, который сверяет afterEach (test-setup.ts).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createOrchestrator } from '../core/orchestrator.ts';

const FIXTURE_PATH = path.join(
    process.cwd(),
    '.claude',
    'ralph',
    'tests',
    '__fixtures__',
    'foreign-project',
    'ralph.config.json',
);

const FLAGS_DRY = { once: false, dry: true, reset: false, resubmit: false, deployResolved: false };

// Мост из entry (телеграм/gate-env) — фейки, профиль фикстуры не prod, их не зовут.
function buildRuntime() {
    return createOrchestrator({
        argv: [],
        flags: FLAGS_DRY,
        external: {
            sendTelegramMessage: () => false,
            telegramConfigFromEnv: () => ({ token: '', chatId: '' }),
            buildSanitizedGateEnv: () => ({}),
        },
    });
}

function loadFixtureRaw() {
    return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
}

describe('фикстурный чужой проект — сама фикстура (#371)', () => {
    it('не пересекается по ключевым значениям с боевым ralph.config.json', () => {
        const raw = loadFixtureRaw();
        const real = JSON.parse(
            fs.readFileSync(
                path.join(process.cwd(), '.claude', 'ralph', 'ralph.config.json'),
                'utf-8',
            ),
        );
        expect(raw.common.board.owner).not.toBe(real.common.board.owner);
        expect(raw.common.installCmd).not.toBe(real.common.installCmd);
        expect(raw.common.runnerWorktreeDirname).not.toBe(real.common.runnerWorktreeDirname);
        expect(raw.common.deployCheck.healthUrl).not.toBe(real.common.deployCheck.healthUrl);
        expect(raw.common.phases[0].milestone).not.toBe(real.common.phases[0].milestone);
        expect(raw.common.phases[0].branch).not.toBe(real.common.phases[0].branch);
        expect(raw.common.prompt).not.toBe(real.common.prompt);
        expect(raw.common.modelRouting.labels['complexity:medium']).not.toBe(
            real.common.modelRouting.labels['complexity:medium'],
        );
        expect(raw.common.gate.checks).not.toEqual(real.common.gate.checks);
    });
});

describe('dry-run переносимости ядра на чужом конфиге (#371)', () => {
    it('resolveProfile инициализирует фикстуру без ошибок и без подмешивания боевых значений', () => {
        const runtime = buildRuntime();
        const raw = loadFixtureRaw();
        const cfg = runtime.resolveProfile(raw, 'playground', (msg: string) => {
            throw new Error(msg);
        }) as Record<string, unknown>;

        expect(cfg.profileName).toBe('playground');
        expect((cfg.board as { owner: string }).owner).toBe('OrbitalLabs');
        expect((cfg.board as { number: number }).number).toBe(42);
        expect(cfg.installCmd).toBe('pnpm install --frozen-lockfile');
        expect(cfg.runnerWorktreeDirname).toBe('sputnik-tracker-ralph');
        expect((cfg.deployCheck as { healthUrl: string }).healthUrl).toBe(
            'https://status.orbitallabs.example/health',
        );
        expect((cfg.phases as Array<{ milestone: string }>)[0].milestone).toBe(
            'Sputnik Tracker · Фаза 1: Каркас',
        );
        expect(cfg.prompt).toContain('AGENTS.md фикстурного проекта');
    });

    it('preflight + один dry-проход runLoop планируют фазу СТРОГО из фикстуры, не трогая реальные git/gh/claude', () => {
        const runtime = buildRuntime();
        const raw = loadFixtureRaw();
        const cfg = runtime.resolveProfile(raw, 'playground', (msg: string) => {
            throw new Error(msg);
        }) as Parameters<typeof runtime.preflight>[0];

        // pickModel (не подменяем — хотим ПРОВЕРИТЬ реальный роутинг) читает фабричный
        // config, который в бою присваивает main(); здесь — тестовый хук #204.
        runtime.setConfigForTests(cfg);

        const logs: string[] = [];
        const shCalls: string[] = [];
        // Фейковый shFn — единственная точка, куда preflight мог бы дотянуться до
        // настоящего git/gh (git rev-parse/gh auth status/git status --porcelain — они НЕ
        // гейтятся dry-флагом). Реальный sh() под RALPH_NO_SIDE_EFFECTS=1 бросил бы.
        const fakeSh = (cmd: string) => {
            shCalls.push(cmd);
            return '';
        };

        const ctx = runtime.preflight(cfg, {
            shFn: fakeSh,
            failFn: (msg: string) => {
                throw new Error(msg);
            },
            logFn: (m: string) => logs.push(m),
            loadStateFn: () => ({
                count: 0,
                milestone: (cfg.phases as Array<{ milestone: string }>)[0].milestone,
                submitted: false,
                noProgress: 0,
                gateHeals: 0,
                blockedHeals: 0,
                reviewModelFloor: null,
                lastReviewModel: null,
                reReviewPending: false,
                deployBlock: null,
            }),
            closeMilestonesFn: () => {
                throw new Error('closeMilestonesFn не должен звонить в dry-режиме');
            },
            phaseIndexOfFn: () => 0,
            saveStateFn: () => {},
            pushEventFn: () => false,
            dry: true,
        });

        expect(ctx.state.milestone).toBe('Sputnik Tracker · Фаза 1: Каркас');
        // git/gh только ЧИТАЮТСЯ через подменённый shFn — ни одного реального вызова.
        expect(shCalls.some((c) => c.includes('git rev-parse'))).toBe(true);
        expect(shCalls.some((c) => c.includes('gh auth status'))).toBe(true);

        const fixtureIssue = {
            number: 101,
            title: 'Чужой issue фикстурного проекта',
            labels: [{ name: 'complexity:medium' }],
            author: { login: 'orbital-bot' },
        };

        const openIssuesCalls: string[] = [];
        const runClaudeCalls: Array<{ prompt: string; model?: string }> = [];
        const savedStates: unknown[] = [];

        runtime.runLoop(cfg, ctx, {
            dry: true,
            once: false,
            logFn: (m: string) => logs.push(m),
            shFn: fakeSh,
            saveStateFn: (s: unknown) => savedStates.push(s),
            // #369: дефолты этих коллабораторов читают adapters.* — фабрика собрала
            // адаптеры без выбора из фикстуры (main() их не звал), поэтому КАЖДЫЙ
            // такой дефолт подменяем явно; необращённые к ним ветки этого dry-прохода
            // всё равно проходят через связывание параметров при входе в runLoop.
            openIssuesFn: (milestone: string) => {
                openIssuesCalls.push(milestone);
                return [fixtureIssue];
            },
            allOpenIssuesFn: () => [],
            removeBlockedLabelFn: () => {},
            addBlockedLabelFn: () => {},
            phaseMergedFn: () => true,
            mergedPhasePrFn: () => null,
            closeMilestoneByTitleFn: () => {
                throw new Error('closeMilestoneByTitleFn не должен вызываться в dry-режиме');
            },
            syncProjectBoardFn: () => {
                throw new Error('syncProjectBoardFn не должен вызываться в dry-режиме');
            },
            mergedShaOfFn: () => '',
            waitForDeployRunFn: () => ({ ok: false }) as never,
            checkProdHealthFn: () => ({ ok: false }) as never,
            runClaudeFn: (prompt: string, opts: { model?: string }) => {
                runClaudeCalls.push({ prompt, model: opts.model });
                return 0;
            },
        });

        // Фаза/milestone — только из фикстуры (не боевой pixel-tanks milestone).
        expect(openIssuesCalls).toEqual(['Sputnik Tracker · Фаза 1: Каркас']);

        // Роутинг модели — РЕАЛЬНЫЙ pickModel (не подменён), читает фикстурный
        // modelRouting.labels['complexity:medium']. Если бы ядро тянуло дефолт мимо
        // конфига (например, боевую claude-sonnet-5), этот ассерт бы упал.
        expect(runClaudeCalls).toHaveLength(1);
        expect(runClaudeCalls[0].model).toBe('fixture-coder-model-medium');

        // Промпт собран из cfg.prompt фикстуры с подстановкой ЕЁ milestone/branch —
        // не боевого шаблона ralph.config.json и не боевых имён фазы/ветки.
        expect(runClaudeCalls[0].prompt).toContain('AGENTS.md фикстурного проекта');
        expect(runClaudeCalls[0].prompt).toContain('Sputnik Tracker · Фаза 1: Каркас');
        expect(runClaudeCalls[0].prompt).toContain('feature/sputnik-phase-1-scaffold');
        expect(runClaudeCalls[0].prompt).not.toContain('pixel-tanks');
        expect(runClaudeCalls[0].prompt).not.toContain('AtlantaTeam');

        // dry: gh/board/milestone-мутации не звонились (см. throw-фейки выше) —
        // если бы позвонились, тест уже упал бы исключением из runLoop.
        expect(savedStates.length).toBeGreaterThan(0);
    });
});
