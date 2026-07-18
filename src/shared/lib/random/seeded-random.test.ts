import { describe, expect, it } from 'vitest';
import { createSeededRandom } from './seeded-random';

const takeSequence = (random: () => number, count: number) =>
    Array.from({ length: count }, () => random());

describe('createSeededRandom', () => {
    it('возвращает идентичную последовательность для одного числового seed', () => {
        const first = takeSequence(createSeededRandom(42), 100);
        const second = takeSequence(createSeededRandom(42), 100);

        expect(first).toEqual(second);
    });

    it('возвращает идентичную последовательность для одного строкового seed', () => {
        const first = takeSequence(createSeededRandom('daily-2026-07-18'), 100);
        const second = takeSequence(createSeededRandom('daily-2026-07-18'), 100);

        expect(first).toEqual(second);
    });

    it('возвращает разные последовательности для разных seed', () => {
        const first = takeSequence(createSeededRandom(1), 10);
        const second = takeSequence(createSeededRandom(2), 10);

        expect(first).not.toEqual(second);
    });

    it('возвращает разные последовательности для разных строковых seed', () => {
        const first = takeSequence(createSeededRandom('alpha'), 10);
        const second = takeSequence(createSeededRandom('beta'), 10);

        expect(first).not.toEqual(second);
    });

    it('генерирует значения только в диапазоне [0, 1)', () => {
        const random = createSeededRandom(2026);
        const values = takeSequence(random, 1000);

        values.forEach((value) => {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        });
    });

    it('не выдаёт вырожденную последовательность из одинаковых значений', () => {
        const values = takeSequence(createSeededRandom(0), 100);

        expect(new Set(values).size).toBeGreaterThan(90);
    });
});
