import { describe, expect, it } from 'vitest';
import {
    checkBaselineReduction,
    checkRatchet,
    gitBaseBaseline,
    loadBaseline,
    reductionPushText,
    runRatchetCheck,
} from './test-ratchet.mjs';

// #156: храповик числа тестов. Гейт краснеет, когда фактическое число собранных тестов
// падает НИЖЕ эталона (count из test-count.baseline.json), — не когда оно просто
// отличается. Рост проходит зелёным без правки эталона.

// Хелпер readFn для loadBaseline: отдаёт JSON объекта. Нужен единственному тесту
// (легальное удаление) в describe('checkRatchet') и тестам loadBaseline — держим на
// модульном уровне, а не дублируем в каждом describe.
const read = (obj) => () => JSON.stringify(obj);

describe('loadBaseline', () => {
    it('возвращает объект эталона с count', () => {
        expect(loadBaseline(read({ count: 928 }), 'x').count).toBe(928);
    });

    it('падает, когда count не целое — эталон испорчен, не «посчитаем как 0»', () => {
        expect(() => loadBaseline(read({ count: '928' }), 'x')).toThrow(/count/);
    });

    it('падает на отрицательном count', () => {
        expect(() => loadBaseline(read({ count: -1 }), 'x')).toThrow(/count/);
    });

    it('падает, когда count отсутствует — неожиданный формат', () => {
        expect(() => loadBaseline(read({ reason: 'нет count' }), 'x')).toThrow(/count/);
    });
});

describe('checkRatchet', () => {
    it('падение ниже эталона — красный', () => {
        expect(checkRatchet(925, { count: 928 }).ok).toBe(false);
    });

    it('сообщение красного называет, скольких тестов не досчитались (было/собрано/нехватка)', () => {
        const { message } = checkRatchet(925, { count: 928 });
        expect(message).toMatch(/928/); // было
        expect(message).toMatch(/925/); // собрано
        expect(message).toMatch(/не хватает 3/); // нехватка
    });

    it('красный указывает путь к осознанному снижению эталона с reason', () => {
        const { message } = checkRatchet(900, { count: 928 });
        expect(message).toMatch(/test-count\.baseline\.json/);
        expect(message).toMatch(/reason/);
    });

    it('равно эталону — зелёный', () => {
        expect(checkRatchet(928, { count: 928 }).ok).toBe(true);
    });

    it('рост числа тестов — зелёный без правки эталона', () => {
        const { ok, message } = checkRatchet(940, { count: 928 });
        expect(ok).toBe(true);
        expect(message).toMatch(/12/); // прирост показан
    });

    // #158: легальное удаление — эталон в том же PR осознанно снижен (с обоснованием
    // в reason), фактическое число тестов теперь равно новому, более низкому count.
    // reason не участвует в сравнении (это поле для человека/ревью) — храповик должен
    // пропустить такое снижение зелёным, не отличая его от «эталон просто маленький».
    it('легальное удаление теста с обновлённым эталоном и reason — зелёный', () => {
        const baseline = loadBaseline(
            read({ count: 900, reason: 'дедупликация устаревшего сценария логина (#158)' }),
            'x',
        );
        expect(checkRatchet(900, baseline).ok).toBe(true);
    });
});

// #155/#207: детерминированный барьер снижения эталона относительно origin/main. Снижение
// count без непустого reason — красный; с reason — зелёный + accepted (громкий пуш в main).
describe('checkBaselineReduction (#155/#207)', () => {
    it('базы нет (эталон впервые появляется в PR) — барьер молчит, зелёный', () => {
        expect(checkBaselineReduction({ count: 928 }, null)).toEqual({ ok: true });
    });

    it('эталон не снижен (равен базе) — зелёный', () => {
        expect(checkBaselineReduction({ count: 928 }, { count: 928 })).toEqual({ ok: true });
    });

    it('эталон вырос относительно базы — зелёный', () => {
        expect(checkBaselineReduction({ count: 947 }, { count: 928 })).toEqual({ ok: true });
    });

    it('снижение без reason — красный, с указанием на сколько и куда писать reason', () => {
        const r = checkBaselineReduction({ count: 900 }, { count: 928 });
        expect(r.ok).toBe(false);
        expect(r.message).toMatch(/928/); // база
        expect(r.message).toMatch(/900/); // новый
        expect(r.message).toMatch(/на 28/); // размер снижения
        expect(r.message).toMatch(/reason/);
    });

    it('снижение с пустым/пробельным reason — тоже красный (не «есть поле, значит ок»)', () => {
        expect(checkBaselineReduction({ count: 900, reason: '' }, { count: 928 }).ok).toBe(false);
        expect(checkBaselineReduction({ count: 900, reason: '   ' }, { count: 928 }).ok).toBe(
            false,
        );
    });

    it('снижение с непустым reason — зелёный, но помечен accepted для пуша', () => {
        const r = checkBaselineReduction(
            { count: 900, reason: 'дедупликация (#158)' },
            { count: 928 },
        );
        expect(r.ok).toBe(true);
        expect(r.accepted).toEqual({
            from: 928,
            to: 900,
            drop: 28,
            reason: 'дедупликация (#158)',
        });
    });
});

describe('gitBaseBaseline (#155)', () => {
    it('читает count из origin/main-версии эталона', () => {
        const spawnFn = () => ({ status: 0, stdout: JSON.stringify({ count: 928 }) });
        expect(gitBaseBaseline(spawnFn).count).toBe(928);
    });

    it('файла нет в origin/main (первое появление) — null, не сбой', () => {
        const spawnFn = () => ({
            status: 128,
            stdout: '',
            stderr: "fatal: path 'scripts/test-count.baseline.json' does not exist in 'origin/main'",
        });
        expect(gitBaseBaseline(spawnFn)).toBe(null);
    });

    it('иная ошибка git — throw, не «база пустая» (fail-closed)', () => {
        const spawnFn = () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' });
        expect(() => gitBaseBaseline(spawnFn)).toThrow(/не смог прочитать/);
    });

    it('база с некорректным count — throw (сверка снижения ненадёжна)', () => {
        const spawnFn = () => ({ status: 0, stdout: JSON.stringify({ count: '928' }) });
        expect(() => gitBaseBaseline(spawnFn)).toThrow(/count/);
    });
});

describe('reductionPushText', () => {
    it('громкий текст с ⚠️, числами снижения и обоснованием', () => {
        const text = reductionPushText({ from: 928, to: 900, drop: 28, reason: 'дедуп (#158)' });
        expect(text).toMatch(/⚠️/);
        expect(text).toMatch(/928/);
        expect(text).toMatch(/900/);
        expect(text).toMatch(/дедуп \(#158\)/);
    });
});

// #157: fail-closed на недоверенных данных. Проверяется склейка целиком (runRatchetCheck),
// не отдельные throw'ы loadBaseline/countTests — сомнение в формате данных должно
// долетать до итогового { ok: false }, а не теряться где-то между функциями.
// gitBaseBaselineFn всюду подменён (иначе дефолт сходил бы в реальный git).
describe('runRatchetCheck — fail-closed на недоверенных данных (#157)', () => {
    it('нечитаемый эталон (битый JSON) — красный, не зелёный', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => {
                throw new Error('test-count.baseline.json не распарсился');
            },
            gitBaseBaselineFn: () => null,
            collectTestsJsonFn: () => [],
            countTestsFn: () => 928,
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/не распарсился/);
    });

    it('эталон неожиданного формата (нет count) — красный', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => loadBaseline(() => JSON.stringify({ reason: 'нет count' }), 'x'),
            gitBaseBaselineFn: () => null,
            collectTestsJsonFn: () => [],
            countTestsFn: () => 928,
        });
        expect(result.ok).toBe(false);
    });

    it('отчёт репортёра не собрался (сбой vitest list) — красный', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => ({ count: 928 }),
            gitBaseBaselineFn: () => null,
            collectTestsJsonFn: () => {
                throw new Error('vitest не записал список тестов — сбой сбора');
            },
            countTestsFn: () => 928,
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/сбой сбора/);
    });

    it('отчёт репортёра неожиданной формы (не массив записей) — красный', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => ({ count: 928 }),
            gitBaseBaselineFn: () => null,
            collectTestsJsonFn: () => ({ numTotalTests: 928 }),
            countTestsFn: () => {
                throw new Error('vitest list --json вернул не массив');
            },
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/не массив/);
    });

    it('сбой чтения базовой версии эталона (git упал) — красный, не «база пустая»', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => ({ count: 928 }),
            gitBaseBaselineFn: () => {
                throw new Error('не смог прочитать базовую версию эталона из origin/main');
            },
            collectTestsJsonFn: () => [],
            countTestsFn: () => 928,
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/базовую версию/);
    });

    it('ни один сбойный путь не возвращает ok: true — мягкого режима нет', () => {
        const failing = [
            {
                loadBaselineFn: () => {
                    throw new Error('a');
                },
            },
            {
                loadBaselineFn: () => ({ count: 928 }),
                gitBaseBaselineFn: () => {
                    throw new Error('b');
                },
            },
            {
                loadBaselineFn: () => ({ count: 928 }),
                gitBaseBaselineFn: () => null,
                collectTestsJsonFn: () => {
                    throw new Error('c');
                },
            },
            {
                loadBaselineFn: () => ({ count: 928 }),
                gitBaseBaselineFn: () => null,
                collectTestsJsonFn: () => [],
                countTestsFn: () => {
                    throw new Error('d');
                },
            },
        ];
        for (const overrides of failing) {
            expect(runRatchetCheck(overrides).ok).toBe(false);
        }
    });

    it('доверенные данные без ошибок — обычная сверка с эталоном (регресс склейки)', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => ({ count: 928 }),
            gitBaseBaselineFn: () => null,
            collectTestsJsonFn: () => [],
            countTestsFn: () => 928,
        });
        expect(result).toEqual({
            ok: true,
            message: expect.stringMatching(/928/),
        });
    });
});

// #155/#207: барьер снижения эталона встроен в склейку ПЕРЕД сверкой с фактом.
describe('runRatchetCheck — барьер снижения эталона (#155/#207)', () => {
    it('снижение count без reason — красный ещё до сверки с фактом', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => ({ count: 900 }),
            gitBaseBaselineFn: () => ({ count: 928 }),
            collectTestsJsonFn: () => [],
            countTestsFn: () => 900, // факт совпал бы с новым эталоном, но барьер краснит
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/без обоснования/);
    });

    it('снижение count с reason — зелёный и помечен accepted (для пуша)', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => ({ count: 900, reason: 'дедупликация (#158)' }),
            gitBaseBaselineFn: () => ({ count: 928 }),
            collectTestsJsonFn: () => [],
            countTestsFn: () => 900,
        });
        expect(result.ok).toBe(true);
        expect(result.accepted).toMatchObject({ from: 928, to: 900, drop: 28 });
    });

    it('рост числа тестов над базой — зелёный без accepted', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => ({ count: 928 }),
            gitBaseBaselineFn: () => ({ count: 928 }),
            collectTestsJsonFn: () => [],
            countTestsFn: () => 947,
        });
        expect(result.ok).toBe(true);
        expect(result.accepted).toBeUndefined();
    });
});
