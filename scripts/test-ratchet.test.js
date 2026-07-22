import { describe, expect, it } from 'vitest';
import { checkRatchet, loadBaseline } from './test-ratchet.mjs';

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
});
