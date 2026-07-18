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

    it('генерирует разные массивы высот для разных seed', () => {
        const first = new Ground(WIDTH, HEIGHT, createSeededRandom(1));
        const second = new Ground(WIDTH, HEIGHT, createSeededRandom(2));

        expect(first.heights).not.toEqual(second.heights);
    });

    it('держит высоты в допустимых границах рельефа', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(2026));
        const heightMax = Math.floor(HEIGHT / 2);

        expect(ground.heights).toHaveLength(WIDTH);
        ground.heights.forEach((height) => {
            expect(height).toBeGreaterThanOrEqual(0);
            expect(height).toBeLessThanOrEqual(heightMax);
        });
    });
});
