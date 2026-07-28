// Юнит-тесты модуля state/lock (#359). Здесь проверяется САМА фабрика createStateLock —
// что она собирает рабочие функции из синтетического env, независимо от ralph.js. Проход
// «через ре-экспорт ralph.js» уже покрыт ralph.test.js и lock-scenarios.test.js (те же
// функции, но с боевым контекстом раннера); тут — контракт extraction'а: модуль
// самодостаточен и переносим (цель фазы 2), а не «работает только пока его зовёт ralph.js».
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import type { StateLockEnv } from './state-lock.ts';
import { createStateLock } from './state-lock.ts';

// Синтетический env: пути-заглушки, отдельный (не общий #138) guardSideEffect, чтобы тест
// не трогал журнал side-effect-guard.ts и не зависел от боевого контекста ralph.js.
function makeEnv(over: Partial<StateLockEnv> = {}): StateLockEnv {
    return {
        statePath: '/x/ralph.state.json',
        lockPath: '/x/ralph.lock',
        lockMarkerPath: '.deps-lock.sha',
        ralphPath: '.claude/ralph/ralph.js',
        dry: false,
        getConfig: () => ({ phases: [{ milestone: 'M1' }, { milestone: 'M2' }] }),
        log: () => {},
        fail: () => {},
        guardSideEffect: () => {},
        loadJson: () => null,
        processAlive: () => false,
        cmdlineIncludes: () => false,
        buildSanitizedGateEnv: () => ({ PATH: '/x' }),
        ...over,
    };
}

describe('defaultState — канонический полный state из первой фазы конфига', () => {
    it('milestone берётся из getConfig().phases[0], счётчики нулевые, барьеры пустые', () => {
        const { defaultState } = createStateLock(makeEnv());
        expect(defaultState()).toEqual({
            count: 0,
            milestone: 'M1',
            submitted: false,
            noProgress: 0,
            gateHeals: 0,
            blockedHeals: 0,
            reviewModelFloor: null,
            lastReviewModel: null,
            reReviewPending: false,
            deployBlock: null,
        });
    });

    it('config читается ЛЕНИВО — правка phases после создания фабрики видна', () => {
        let phases = [{ milestone: 'FIRST' }];
        const { defaultState } = createStateLock(makeEnv({ getConfig: () => ({ phases }) }));
        phases = [{ milestone: 'SECOND' }];
        expect(defaultState().milestone).toBe('SECOND');
    });
});

describe('loadState — резолв state с диска через инжектированный loadJson', () => {
    it('валидный state (с milestone) возвращается как есть', () => {
        const state = { count: 5, milestone: 'M3', submitted: true, noProgress: 1 };
        const { loadState } = createStateLock(makeEnv({ loadJson: () => state }));
        expect(loadState()).toEqual(state);
    });

    it('нет файла (loadJson → null) → defaultState первой фазы', () => {
        const { loadState } = createStateLock(makeEnv({ loadJson: () => null }));
        expect(loadState().milestone).toBe('M1');
    });

    it('state старой схемы (без milestone) → зовёт инжектированный failFn', () => {
        const { loadState } = createStateLock(
            makeEnv({ loadJson: () => ({ count: 3, phaseIndex: 0, submitted: false }) }),
        );
        const failFn = vi.fn();
        loadState(failFn);
        expect(failFn).toHaveBeenCalledTimes(1);
        expect(failFn.mock.calls[0][0]).toMatch(/схем|phaseIndex/i);
    });
});

describe('saveState — C1 read-only (dry) + предохранитель #138', () => {
    it('dry=true → не пишет и не трогает guardSideEffect (строго read-only)', () => {
        const guardSideEffect = vi.fn(() => {
            throw new Error('guard не должен зваться в dry');
        });
        const { saveState } = createStateLock(makeEnv({ dry: true, guardSideEffect }));
        expect(() => saveState({ milestone: 'M1' } as never)).not.toThrow();
        expect(guardSideEffect).not.toHaveBeenCalled();
    });

    it('dry=false → проходит через guardSideEffect с путём state (боевой дефолт бы записал)', () => {
        // guard мимикрирует боевой (RALPH_NO_SIDE_EFFECTS): бросает ДО реальной записи на диск.
        const guardSideEffect = vi.fn((what: string) => {
            throw new Error(`${what} запрещено`);
        });
        const { saveState } = createStateLock(makeEnv({ dry: false, guardSideEffect }));
        expect(() => saveState({ milestone: 'M1' } as never)).toThrow(/ralph\.state\.json/);
        expect(guardSideEffect).toHaveBeenCalledWith('saveState(/x/ralph.state.json)');
    });
});

describe('lockHash / syncDepsIfLockChanged — маркер .deps-lock.sha', () => {
    const HASH_OF = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

    it('lockHash: sha256 содержимого package-lock.json, null если файла нет', () => {
        const { lockHash } = createStateLock(makeEnv());
        expect(lockHash('/x', (() => 'LOCKDATA') as never)).toBe(HASH_OF('LOCKDATA'));
        expect(
            lockHash('/x', (() => {
                throw new Error('ENOENT');
            }) as never),
        ).toBeNull();
    });

    it('lock не менялся (маркер == хэш) → npm ci НЕ гоняется', () => {
        const { syncDepsIfLockChanged } = createStateLock(makeEnv());
        const installFn = vi.fn();
        const lock = 'LOCK-A';
        syncDepsIfLockChanged({
            logFn: () => {},
            existsFn: (() => true) as never,
            readFn: ((p: string) =>
                String(p).endsWith('package-lock.json') ? lock : HASH_OF(lock)) as never,
            installFn,
        });
        expect(installFn).not.toHaveBeenCalled();
    });

    it('lock изменился (маркер != хэш) → npm ci и маркер перезаписан', () => {
        const { syncDepsIfLockChanged } = createStateLock(makeEnv());
        const installFn = vi.fn();
        const writes: Array<[string, string]> = [];
        syncDepsIfLockChanged({
            logFn: () => {},
            existsFn: (() => true) as never,
            readFn: ((p: string) =>
                String(p).endsWith('package-lock.json')
                    ? 'LOCK-NEW'
                    : HASH_OF('LOCK-OLD')) as never,
            writeFn: ((p: string, data: string) => writes.push([p, data])) as never,
            installFn,
        });
        expect(installFn).toHaveBeenCalledTimes(1);
        expect(writes.some(([, data]) => data === HASH_OF('LOCK-NEW'))).toBe(true);
    });
});

describe('acquireLock — fail-closed взятие через инжектированные примитивы', () => {
    const enoent = () => {
        const e = new Error('ENOENT') as NodeJS.ErrnoException;
        e.code = 'ENOENT';
        throw e;
    };

    it('лока нет (ENOENT) → берём себе: пишем pid, стоп не зовём', () => {
        const { acquireLock } = createStateLock(makeEnv());
        const writeFn = vi.fn();
        const failFn = vi.fn();
        const ok = acquireLock({
            lockPath: '/x/ralph.lock',
            pid: 777,
            readFn: enoent as never,
            writeFn,
            logFn: vi.fn(),
            failFn,
        });
        expect(ok).toBe(true);
        expect(writeFn).toHaveBeenCalledWith('/x/ralph.lock', '777');
        expect(failFn).not.toHaveBeenCalled();
    });

    it('живой раннер держит лок (processAlive+cmdlineIncludes → true) → отказ с pid и путём', () => {
        // env-примитивы решают живость: оба true = держатель жив и это наш ralph.js.
        const { acquireLock } = createStateLock(
            makeEnv({ processAlive: () => true, cmdlineIncludes: () => true }),
        );
        const writeFn = vi.fn();
        const failFn = vi.fn();
        const ok = acquireLock({
            lockPath: '/x/ralph.lock',
            pid: 777,
            readFn: (() => '4242') as never,
            procReadFn: (() => 'node\0.claude/ralph/ralph.js\0') as never,
            killFn: () => {},
            writeFn,
            logFn: vi.fn(),
            failFn,
        });
        expect(ok).toBe(false);
        expect(failFn).toHaveBeenCalledTimes(1);
        expect(failFn.mock.calls[0][0]).toContain('4242');
        expect(failFn.mock.calls[0][0]).toContain('/x/ralph.lock');
        expect(writeFn).not.toHaveBeenCalled();
    });

    it('осиротевший лок (processAlive → false) → снимаем, берём себе', () => {
        const { acquireLock } = createStateLock(makeEnv({ processAlive: () => false }));
        const writeFn = vi.fn();
        const removeFn = vi.fn();
        const ok = acquireLock({
            lockPath: '/x/ralph.lock',
            pid: 777,
            readFn: (() => '4242') as never,
            procReadFn: (() => '') as never,
            killFn: () => {},
            writeFn,
            removeFn,
            logFn: vi.fn(),
            failFn: vi.fn(),
        });
        expect(ok).toBe(true);
        expect(removeFn).toHaveBeenCalledWith('/x/ralph.lock');
        expect(writeFn).toHaveBeenCalledWith('/x/ralph.lock', '777');
    });

    it('битый лок-файл (не число) → стоп fail-closed, запись не зовём', () => {
        const { acquireLock } = createStateLock(makeEnv());
        const writeFn = vi.fn();
        const failFn = vi.fn();
        const ok = acquireLock({
            lockPath: '/x/ralph.lock',
            pid: 777,
            readFn: (() => 'мусор') as never,
            logFn: vi.fn(),
            failFn,
        });
        expect(ok).toBe(false);
        expect(failFn.mock.calls[0][0]).toMatch(/битый/);
        expect(writeFn).not.toHaveBeenCalled();
    });

    it('гонка взятия: writeFn бросает EEXIST внутри claim() → fail-closed отказ, старт запрещён', () => {
        // Лок появился между чтением (ENOENT) и записью — второй раннер стартовал
        // одновременно и его 'wx' победил. Наш claim() ловит EEXIST и отказывает.
        const { acquireLock } = createStateLock(makeEnv());
        const failFn = vi.fn();
        const writeFn = vi.fn(() => {
            const e = new Error('EEXIST') as NodeJS.ErrnoException;
            e.code = 'EEXIST';
            throw e;
        });
        const ok = acquireLock({
            lockPath: '/x/ralph.lock',
            pid: 777,
            readFn: enoent as never,
            writeFn: writeFn as never,
            logFn: vi.fn(),
            failFn,
        });
        expect(ok).toBe(false);
        expect(failFn).toHaveBeenCalledTimes(1);
        expect(failFn.mock.calls[0][0]).toMatch(/в момент взятия/);
    });

    it('нечитаемый лок-файл (не-ENOENT, напр. EACCES) → fail-closed стоп, не «лока нет»', () => {
        // Любая ошибка чтения кроме ENOENT — НЕ трактуем как свободный лок (это тихий
        // старт поверх возможного живого раннера). Стоп с просьбой разобраться руками.
        const { acquireLock } = createStateLock(makeEnv());
        const failFn = vi.fn();
        const writeFn = vi.fn();
        const eacces = () => {
            const e = new Error('EACCES') as NodeJS.ErrnoException;
            e.code = 'EACCES';
            throw e;
        };
        const ok = acquireLock({
            lockPath: '/x/ralph.lock',
            pid: 777,
            readFn: eacces as never,
            writeFn,
            logFn: vi.fn(),
            failFn,
        });
        expect(ok).toBe(false);
        expect(failFn).toHaveBeenCalledTimes(1);
        expect(failFn.mock.calls[0][0]).toMatch(/нечитаем|EACCES/);
        expect(writeFn).not.toHaveBeenCalled();
    });
});
