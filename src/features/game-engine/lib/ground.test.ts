import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { Ground } from './ground';

const WIDTH = 800;
const HEIGHT = 600;

describe('Ground.generate', () => {
    it('генерирует идентичный массив высот для одного seed', () => {
        const first = new Ground(WIDTH, HEIGHT, createSeededRandom(42));
        const second = new Ground(WIDTH, HEIGHT, createSeededRandom(42));

        expect(first.heights).toEqual(second.heights);
    });

    it('генерирует идентичный массив высот при повторной генерации с тем же seed', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(7));
        const firstHeights = [...ground.heights];

        const regenerated = new Ground(WIDTH, HEIGHT, createSeededRandom(7));

        expect(regenerated.heights).toEqual(firstHeights);
    });

    it('детерминирован для набора разных seed', () => {
        [0, 1, 42, 1234, 99999].forEach((seed) => {
            const first = new Ground(WIDTH, HEIGHT, createSeededRandom(seed));
            const second = new Ground(WIDTH, HEIGHT, createSeededRandom(seed));

            expect(first.heights).toEqual(second.heights);
        });
    });

    it('генерирует разные массивы высот для разных seed', () => {
        const first = new Ground(WIDTH, HEIGHT, createSeededRandom(1));
        const second = new Ground(WIDTH, HEIGHT, createSeededRandom(2));

        expect(first.heights).not.toEqual(second.heights);
    });

    it('даёт разные массивы для нескольких пар соседних seed', () => {
        [
            [10, 11],
            [100, 200],
            [777, 888],
        ].forEach(([seedA, seedB]) => {
            const a = new Ground(WIDTH, HEIGHT, createSeededRandom(seedA));
            const b = new Ground(WIDTH, HEIGHT, createSeededRandom(seedB));

            expect(a.heights).not.toEqual(b.heights);
        });
    });

    it('держит высоты в допустимых границах рельефа', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(2026));
        const heightMax = Math.floor(HEIGHT / 2);
        const heightMin = Math.floor(heightMax / 4);

        expect(ground.heights).toHaveLength(WIDTH);
        ground.heights.forEach((height) => {
            expect(height).toBeGreaterThanOrEqual(heightMin);
            expect(height).toBeLessThanOrEqual(heightMax);
        });
    });

    it('состоит только из целочисленных высот', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(555));

        ground.heights.forEach((height) => {
            expect(Number.isInteger(height)).toBe(true);
        });
    });
});
