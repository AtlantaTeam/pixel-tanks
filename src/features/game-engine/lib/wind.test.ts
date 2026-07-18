import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { generateWind, MAX_WIND } from './wind';

describe('generateWind', () => {
    it('возвращает одинаковый ветер для одного seed', () => {
        const first = generateWind(createSeededRandom(42));
        const second = generateWind(createSeededRandom(42));

        expect(first).toBe(second);
    });

    it('возвращает ветер в диапазоне [-MAX_WIND, MAX_WIND]', () => {
        for (let seed = 0; seed < 100; seed++) {
            const wind = generateWind(createSeededRandom(seed));

            expect(wind).toBeGreaterThanOrEqual(-MAX_WIND);
            expect(wind).toBeLessThanOrEqual(MAX_WIND);
        }
    });

    it('возвращает разный ветер для разных seed', () => {
        const winds = new Set(
            Array.from({ length: 50 }, (_, seed) => generateWind(createSeededRandom(seed))),
        );

        expect(winds.size).toBeGreaterThan(45);
    });
});
