// Юнит-тесты модуля гейта (#362). Основная часть проверяет САМУ фабрику createGateRunner —
// что она собирает рабочие функции из синтетического env, независимо от ralph.js: контракт
// extraction'а — модуль самодостаточен и переносим (цель фазы 3), а не «работает только
// пока его зовёт ralph.js». Проход «через ре-экспорт ralph.js» с боевым контекстом раннера —
// в orchestrator.test.js / blocked-scenarios.test.js / hold-scenarios.test.js и в блоке в
// конце этого файла, перенесённом из ralph.test.js при её разнесении по модулям (#366).
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — JS-entry раннера без деклараций типов; блок в конце файла перенесён
// из ralph.test.js как есть и ходит через его ре-экспорт (#366).
import ralph from './ralph.js';
import type { GateEnv } from './gate.ts';
import { createGateRunner } from './gate.ts';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

// Синтетический env: заглушки-коллабораторы, которые молча падают, если функция под
// тестом зовёт побочку без явного override, — забытый override становится громкой
// ошибкой теста, а не тихим проходом через боевой sh/gh.
function makeEnv(over: Partial<GateEnv> = {}): GateEnv {
    return {
        sh: () => {
            throw new Error('sh не подменён в тесте');
        },
        shArgv: () => {
            throw new Error('shArgv не подменён в тесте');
        },
        shq: (v: unknown) => `'${String(v).replace(/'/g, `'\\''`)}'`,
        log: () => {},
        ghJson: () => {
            throw new Error('ghJson не подменён в тесте');
        },
        safeBranch: () => true,
        findOpenPr: () => null,
        ensureClean: () => true,
        parkOnOriginMain: () => {},
        updateRunnerTreeToOriginMain: () => {},
        syncDepsIfLockChanged: () => {},
        buildSanitizedGateEnv: () => ({ PATH: '/x' }),
        formatExcerpt: (s: string) => s,
        sleep: () => {},
        dry: false,
        SHA40_RE: /^[0-9a-f]{40}$/,
        PR_NUMBER_RE: /^\d+$/,
        runnerTreeFixHint: 'git fetch origin main && git checkout --detach origin/main',
        ...over,
    };
}

describe('gateChecksFor — состав шагов по профилю (#80)', () => {
    it('дефолт (playground): только базовый набор, включая test', () => {
        const { gateChecksFor } = createGateRunner(makeEnv());
        const names = gateChecksFor().map(([n]) => n);
        expect(names).toContain('test');
        expect(names).not.toContain('e2e');
        expect(names).not.toContain('coverage');
    });

    it('prod: базовый `test` снят (дедуп с coverage), добавлены толстые чеки', () => {
        const { gateChecksFor } = createGateRunner(makeEnv());
        const names = gateChecksFor('prod').map(([n]) => n);
        expect(names).not.toContain('test');
        expect(names).toEqual(expect.arrayContaining(['security', 'coverage', 'e2e']));
        // build остаётся из базы
        expect(names).toContain('build');
    });

    it('возвращает КОПИЮ, не ссылку на BASE_GATE_CHECKS (мутация не течёт)', () => {
        const { gateChecksFor, BASE_GATE_CHECKS } = createGateRunner(makeEnv());
        const list = gateChecksFor();
        list.push(['x', 'echo x']);
        expect(gateChecksFor().length).toBe(BASE_GATE_CHECKS.length);
    });
});

describe('checksGreen — прогон шагов на голове PR (#77)', () => {
    function greenEnvCalls() {
        const runArgv = vi.fn(() => '');
        const park = vi.fn();
        const syncDeps = vi.fn();
        // rev-parse → пусто (локальной ветки нет); прочие sh — команды чеков, зелёные.
        const sh = vi.fn(() => '');
        return { runArgv, park, syncDeps, sh };
    }

    it('все чеки зелёные → true; запоминает verifiedHead; парковку не зовёт', () => {
        const { runArgv, park, syncDeps, sh } = greenEnvCalls();
        const g = createGateRunner(makeEnv({ parkOnOriginMain: park }));
        const ok = g.checksGreen('feature/x', 7, {
            shFn: sh,
            runArgvFn: runArgv,
            ghJsonFn: (() => ({ headRefOid: SHA })) as GateEnv['ghJson'],
            syncDepsFn: syncDeps,
            checks: [['lint', 'npm run lint']],
        });
        expect(ok).toBe(true);
        expect(g.getVerifiedHead()).toBe(SHA);
        expect(g.getLastRedCheck()).toBeNull();
        expect(park).not.toHaveBeenCalled();
        // syncDeps и чек получили санированный env
        expect(syncDeps).toHaveBeenCalledWith({ env: { PATH: '/x' } });
        expect(sh).toHaveBeenCalledWith('npm run lint', { env: { PATH: '/x' } });
    });

    it('красный чек → false; lastRedCheck заполнен, парковка вызвана', () => {
        const park = vi.fn();
        const g = createGateRunner(makeEnv({ parkOnOriginMain: park }));
        const sh = vi.fn((cmd: string) => {
            if (cmd.includes('rev-parse')) return '';
            const e = new Error('boom') as Error & { stderr?: string };
            e.stderr = 'tests failed here';
            throw e;
        });
        const ok = g.checksGreen('feature/x', 7, {
            shFn: sh,
            runArgvFn: () => '',
            ghJsonFn: (() => ({ headRefOid: SHA })) as GateEnv['ghJson'],
            syncDepsFn: () => {},
            checks: [['test', 'npm run test']],
        });
        expect(ok).toBe(false);
        expect(g.getLastRedCheck()).toMatchObject({ name: 'test', cmd: 'npm run test' });
        expect(g.getLastRedCheck()?.excerpt).toContain('tests failed here');
        expect(g.getVerifiedHead()).toBeNull();
        expect(park).toHaveBeenCalledTimes(1);
    });

    it('имя ветки не прошло safeBranch → false, парковка, git не трогаем', () => {
        const park = vi.fn();
        const runArgv = vi.fn(() => '');
        const g = createGateRunner(makeEnv({ safeBranch: () => false, parkOnOriginMain: park }));
        const ok = g.checksGreen('bad branch', 7, { runArgvFn: runArgv });
        expect(ok).toBe(false);
        expect(park).toHaveBeenCalledTimes(1);
        expect(runArgv).not.toHaveBeenCalled();
    });

    it('санация env упала → fail-closed: false, чеки не запущены, парковка', () => {
        const park = vi.fn();
        const sh = vi.fn(() => '');
        const g = createGateRunner(makeEnv({ parkOnOriginMain: park }));
        const ok = g.checksGreen('feature/x', 7, {
            shFn: sh,
            runArgvFn: () => '',
            ghJsonFn: (() => ({ headRefOid: SHA })) as GateEnv['ghJson'],
            buildGateEnvFn: () => {
                throw new Error('битый allowlist');
            },
            checks: [['lint', 'npm run lint']],
        });
        expect(ok).toBe(false);
        expect(park).toHaveBeenCalledTimes(1);
        // до чеков не дошли: sh звался только на rev-parse, не на команду чека
        expect(sh).not.toHaveBeenCalledWith('npm run lint', expect.anything());
    });

    it('H3: локальная ветка разошлась с головой PR → false, чеки не гонятся', () => {
        const park = vi.fn();
        const syncDeps = vi.fn();
        const g = createGateRunner(makeEnv({ parkOnOriginMain: park }));
        const sh = vi.fn((cmd: string) => (cmd.includes('rev-parse') ? OTHER_SHA : ''));
        const ok = g.checksGreen('feature/x', 7, {
            shFn: sh,
            runArgvFn: () => '',
            ghJsonFn: (() => ({ headRefOid: SHA })) as GateEnv['ghJson'],
            syncDepsFn: syncDeps,
            checks: [['lint', 'npm run lint']],
        });
        expect(ok).toBe(false);
        expect(syncDeps).not.toHaveBeenCalled();
        expect(park).toHaveBeenCalledTimes(1);
    });

    it('headRefOid не похож на sha → fail-closed', () => {
        const park = vi.fn();
        const g = createGateRunner(makeEnv({ parkOnOriginMain: park }));
        const ok = g.checksGreen('feature/x', 7, {
            shFn: () => '',
            runArgvFn: () => '',
            ghJsonFn: (() => ({ headRefOid: 'not-a-sha' })) as GateEnv['ghJson'],
            checks: [['lint', 'npm run lint']],
        });
        expect(ok).toBe(false);
        expect(park).toHaveBeenCalledTimes(1);
    });
});

describe('tryMergePhase — гейт мерджа: hold/blocked/red/merged', () => {
    const phase = { branch: 'feature/x', milestone: 'M' };

    it('dry → not-merged, ничего не мерджим', () => {
        const g = createGateRunner(makeEnv({ dry: true }));
        const runArgv = vi.fn(() => '');
        expect(tryMergeWith(g, phase, { runArgvFn: runArgv })).toBe('not-merged');
        expect(runArgv).not.toHaveBeenCalled();
    });

    it('грязное дерево (ensureClean=false) → not-merged', () => {
        const g = createGateRunner(makeEnv());
        expect(tryMergeWith(g, phase, { ensureCleanFn: () => false })).toBe('not-merged');
    });

    it('открытого PR нет → not-merged', () => {
        const g = createGateRunner(makeEnv());
        expect(tryMergeWith(g, phase, { findOpenPrFn: () => null })).toBe('not-merged');
    });

    it('hold сильнее blocked — проверяется первым', () => {
        const g = createGateRunner(makeEnv());
        const res = tryMergeWith(g, phase, {
            findOpenPrFn: () => ({ number: 9, labels: [{ name: 'blocked' }, { name: 'hold' }] }),
        });
        expect(res).toBe('hold');
        expect(g.getLastGatePr()).toBe(9);
    });

    it('label blocked → blocked', () => {
        const g = createGateRunner(makeEnv());
        const res = tryMergeWith(g, phase, {
            findOpenPrFn: () => ({ number: 9, labels: [{ name: 'blocked' }] }),
        });
        expect(res).toBe('blocked');
    });

    it('красный чек → red-checks', () => {
        const g = createGateRunner(makeEnv());
        const res = tryMergeWith(g, phase, {
            findOpenPrFn: () => ({ number: 9, labels: [] }),
            checksGreenFn: () => false,
            getLastRedCheckFn: () => ({ name: 'test', cmd: 'npm run test', excerpt: 'x' }),
        });
        expect(res).toBe('red-checks');
    });

    it('гейт упал ДО чеков (redCheck пуст) → not-merged', () => {
        const g = createGateRunner(makeEnv());
        const res = tryMergeWith(g, phase, {
            findOpenPrFn: () => ({ number: 9, labels: [] }),
            checksGreenFn: () => false,
            getLastRedCheckFn: () => null,
        });
        expect(res).toBe('not-merged');
    });

    it('зелёный гейт → merged; merge зовётся с --match-head-commit, дерево обновлено', () => {
        const runArgv = vi.fn(() => '');
        const updateTree = vi.fn();
        const g = createGateRunner(makeEnv({ updateRunnerTreeToOriginMain: updateTree }));
        const res = tryMergeWith(g, phase, {
            runArgvFn: runArgv,
            findOpenPrFn: () => ({ number: 9, labels: [] }),
            checksGreenFn: () => true,
            getVerifiedHeadFn: () => SHA,
        });
        expect(res).toBe('merged');
        expect(runArgv).toHaveBeenCalledWith('gh', [
            'pr',
            'merge',
            '9',
            '--squash',
            '--delete-branch',
            '--match-head-commit',
            SHA,
        ]);
        expect(updateTree).toHaveBeenCalledTimes(1);
    });

    it('merge прошёл, обновление дерева упало → merged-local-stale', () => {
        const g = createGateRunner(
            makeEnv({
                updateRunnerTreeToOriginMain: () => {
                    throw new Error('detach упал');
                },
            }),
        );
        const res = tryMergeWith(g, phase, {
            runArgvFn: () => '',
            findOpenPrFn: () => ({ number: 9, labels: [] }),
            checksGreenFn: () => true,
            getVerifiedHeadFn: () => SHA,
        });
        expect(res).toBe('merged-local-stale');
    });
});

// tryMergePhase со стабами побочек: sleep/park/phaseMerged по умолчанию безвредны,
// поверх них тест кладёт свои override'ы.
function tryMergeWith(
    g: ReturnType<typeof createGateRunner>,
    phase: { branch: string; milestone?: string },
    over: Record<string, unknown>,
) {
    return g.tryMergePhase(phase, {
        shFn: () => '',
        runArgvFn: () => '',
        ensureCleanFn: () => true,
        sleepFn: () => {},
        parkFn: () => {},
        phaseMergedFn: () => false,
        ...over,
    });
}

describe('removeBlockedLabel / addBlockedLabel — детерминированный переход метки (#217/#223)', () => {
    it('removeBlockedLabel: снимает метку через argv gh pr edit', () => {
        const g = createGateRunner(makeEnv());
        const runArgv = vi.fn(() => '');
        g.removeBlockedLabel('feature/x', { shFn: () => '42', runArgvFn: runArgv });
        expect(runArgv).toHaveBeenCalledWith('gh', [
            'pr',
            'edit',
            '42',
            '--remove-label',
            'blocked',
        ]);
    });

    it('addBlockedLabel: возвращает метку через argv gh pr edit', () => {
        const g = createGateRunner(makeEnv());
        const runArgv = vi.fn(() => '');
        g.addBlockedLabel('feature/x', { shFn: () => '42', runArgvFn: runArgv });
        expect(runArgv).toHaveBeenCalledWith('gh', ['pr', 'edit', '42', '--add-label', 'blocked']);
    });

    it('нет открытого PR → метку не трогаем (fail-closed, но не бросает)', () => {
        const g = createGateRunner(makeEnv());
        const runArgv = vi.fn(() => '');
        g.removeBlockedLabel('feature/x', { shFn: () => '', runArgvFn: runArgv });
        expect(runArgv).not.toHaveBeenCalled();
    });

    it('номер PR не похож на целое → в argv не пускаем', () => {
        const g = createGateRunner(makeEnv());
        const runArgv = vi.fn(() => '');
        g.removeBlockedLabel('feature/x', { shFn: () => '--evil', runArgvFn: runArgv });
        expect(runArgv).not.toHaveBeenCalled();
    });

    it('имя ветки не прошло safeBranch → ничего не делаем', () => {
        const g = createGateRunner(makeEnv({ safeBranch: () => false }));
        const sh = vi.fn(() => '42');
        g.removeBlockedLabel('bad branch', { shFn: sh, runArgvFn: () => '' });
        expect(sh).not.toHaveBeenCalled();
    });
});

// #366: fail-open переходы метки blocked — сценарии, которых нет в фабричных тестах выше.
// Косметика метки не имеет права ронять цикл сдачи: не сняли — гейт подберёт blocked,
// не вернули — блок останется снятым, но петля продолжит работать, а не упадёт.
describe('removeBlockedLabel / addBlockedLabel — сбой gh не роняет петлю (#217/#223)', () => {
    const { removeBlockedLabel, addBlockedLabel } = ralph;

    it('сбой gh не роняет (fail-open): метка останется, гейт подберёт blocked', () => {
        const shFn = () => {
            throw new Error('gh boom');
        };
        const logs: string[] = [];
        expect(() =>
            removeBlockedLabel('feature/m1', { shFn, logFn: (m: string) => logs.push(m) }),
        ).not.toThrow();
        expect(logs.join('\n')).toMatch(/не снял метку/);
    });

    it('сбой argv-мутации не роняет (fail-open): метка останется, гейт подберёт blocked', () => {
        const shFn = (cmd: string) => (cmd.includes('gh pr list') ? '42\n' : '');
        const runArgvFn = () => {
            throw new Error('gh edit boom');
        };
        const logs: string[] = [];
        expect(() =>
            removeBlockedLabel('feature/m1', {
                shFn,
                runArgvFn,
                logFn: (m: string) => logs.push(m),
            }),
        ).not.toThrow();
        expect(logs.join('\n')).toMatch(/не снял метку/);
    });

    it('addBlockedLabel: сбой argv-мутации не роняет — только лог', () => {
        const shFn = (cmd: string) => (cmd.includes('gh pr list') ? '42\n' : '');
        const runArgvFn = () => {
            throw new Error('gh edit boom');
        };
        const logs: string[] = [];
        expect(() =>
            addBlockedLabel('feature/m1', { shFn, runArgvFn, logFn: (m: string) => logs.push(m) }),
        ).not.toThrow();
        expect(logs.join('\n')).toMatch(/не вернул метку/);
    });
});
