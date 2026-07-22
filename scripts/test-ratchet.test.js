import { describe, expect, it } from 'vitest';
import { checkRatchet, loadBaseline, runRatchetCheck } from './test-ratchet.mjs';

// #156: храповик числа тестов. Гейт краснеет, когда фактическое число собранных тестов
// падает НИЖЕ эталона (count из test-count.baseline.json), — не когда оно просто
// отличается. Рост проходит зелёным без правки эталона.

describe('loadBaseline', () => {
    const read = (obj) => () => JSON.stringify(obj);

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
    const read = (obj) => () => JSON.stringify(obj);

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

// #157: fail-closed на недоверенных данных. Проверяется склейка целиком (runRatchetCheck),
// не отдельные throw'ы loadBaseline/countTests — сомнение в формате данных должно
// долетать до итогового { ok: false }, а не теряться где-то между функциями.
describe('runRatchetCheck — fail-closed на недоверенных данных (#157)', () => {
    it('нечитаемый эталон (битый JSON) — красный, не зелёный', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => {
                throw new Error('test-count.baseline.json не распарсился');
            },
            collectTestsJsonFn: () => [],
            countTestsFn: () => 928,
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/не распарсился/);
    });

    it('эталон неожиданного формата (нет count) — красный', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => loadBaseline(() => JSON.stringify({ reason: 'нет count' }), 'x'),
            collectTestsJsonFn: () => [],
            countTestsFn: () => 928,
        });
        expect(result.ok).toBe(false);
    });

    it('отчёт репортёра не собрался (сбой vitest list) — красный', () => {
        const result = runRatchetCheck({
            loadBaselineFn: () => ({ count: 928 }),
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
            collectTestsJsonFn: () => ({ numTotalTests: 928 }),
            countTestsFn: () => {
                throw new Error('vitest list --json вернул не массив');
            },
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/не массив/);
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
                collectTestsJsonFn: () => {
                    throw new Error('b');
                },
            },
            {
                loadBaselineFn: () => ({ count: 928 }),
                collectTestsJsonFn: () => [],
                countTestsFn: () => {
                    throw new Error('c');
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
            collectTestsJsonFn: () => [],
            countTestsFn: () => 928,
        });
        expect(result).toEqual({
            ok: true,
            message: expect.stringMatching(/928/),
        });
    });
});
