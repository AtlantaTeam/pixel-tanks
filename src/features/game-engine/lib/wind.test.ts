import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { generateWind, MAX_WIND, windDirection, windMagnitude } from './wind';

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

describe('windDirection', () => {
    it('положительный ветер сносит вправо', () => {
        expect(windDirection(0.006)).toBe('right');
    });

    it('отрицательный ветер сносит влево', () => {
        expect(windDirection(-0.006)).toBe('left');
    });

    it('штиль (нулевой ветер) считается направленным вправо (нейтраль стрелки)', () => {
        expect(windDirection(0)).toBe('right');
    });
});

describe('windMagnitude', () => {
    it('штиль — 0 из шкалы', () => {
        expect(windMagnitude(0)).toBe(0);
    });

    it('максимальный ветер — верх шкалы (3)', () => {
        expect(windMagnitude(MAX_WIND)).toBe(3);
        expect(windMagnitude(-MAX_WIND)).toBe(3);
    });

    it('половина максимума округляется к ближайшему делению шкалы', () => {
        expect(windMagnitude(MAX_WIND / 2)).toBe(2);
    });

    it('не выходит за верх шкалы даже для ветра сильнее MAX_WIND', () => {
        expect(windMagnitude(MAX_WIND * 10)).toBe(3);
    });

    it('знак ветра не влияет на силу — только на направление', () => {
        expect(windMagnitude(-MAX_WIND / 2)).toBe(windMagnitude(MAX_WIND / 2));
    });
});
