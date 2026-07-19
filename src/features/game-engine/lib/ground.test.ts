import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('Ground.resize', () => {
    it('не трогает RNG — поток случайных чисел после resize не смещается', () => {
        const resizedRandom = createSeededRandom(42);
        const controlRandom = createSeededRandom(42);
        const resized = new Ground(WIDTH, HEIGHT, resizedRandom);
        new Ground(WIDTH, HEIGHT, controlRandom);

        resized.resize(WIDTH * 2, HEIGHT * 2);

        expect(resizedRandom()).toBe(controlRandom());
    });

    it('сохраняет рельеф при resize в тот же размер', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(42));
        const before = [...ground.heights];

        ground.resize(WIDTH, HEIGHT);

        expect(ground.heights).toEqual(before);
    });

    it('масштабирует высоты пропорционально по вертикали', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(7));
        const before = [...ground.heights];

        ground.resize(WIDTH, HEIGHT * 2);

        expect(ground.heights).toEqual(before.map((h) => h * 2));
    });

    it('интерполирует профиль по ширине, сохраняя крайние точки', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(7));
        const before = [...ground.heights];

        ground.resize(WIDTH * 2, HEIGHT);

        expect(ground.heights).toHaveLength(WIDTH * 2);
        expect(ground.heights[0]).toBe(before[0]);
        expect(ground.heights[WIDTH * 2 - 1]).toBe(before[WIDTH - 1]);
    });

    it('сохраняет кратер (изменённый профиль) при масштабировании', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(11));
        const craterX = 400;
        ground.heights[craterX] -= 30;
        const craterBefore = ground.heights[craterX];

        ground.resize(WIDTH, HEIGHT);

        expect(ground.heights[craterX]).toBe(craterBefore);
    });

    it('после resize высоты целочисленные', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(555));

        ground.resize(637, 411);

        expect(ground.heights).toHaveLength(637);
        ground.heights.forEach((height) => {
            expect(Number.isInteger(height)).toBe(true);
        });
    });
});

const makeLayerCtx = () => ({
    strokeStyle: '',
    lineWidth: 0,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
});

const makeDestCtx = () => ({
    drawImage: vi.fn(),
});

describe('Ground: offscreen-кэш террейна (.claude/rules/canvas.md)', () => {
    let layerCtxMock: ReturnType<typeof makeLayerCtx>;
    const originalCreateElement = document.createElement.bind(document);

    beforeEach(() => {
        layerCtxMock = makeLayerCtx();
        vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
            if (tagName === 'canvas') {
                return {
                    width: 0,
                    height: 0,
                    getContext: () => layerCtxMock,
                } as unknown as HTMLCanvasElement;
            }
            return originalCreateElement(tagName);
        }) as typeof document.createElement);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('draw() строит path в offscreen-слое один раз, пока рельеф не меняется', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        const destCtx = makeDestCtx();

        ground.draw(destCtx as unknown as CanvasRenderingContext2D);
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        expect(layerCtxMock.beginPath).toHaveBeenCalledTimes(1);
        expect(destCtx.drawImage).toHaveBeenCalledTimes(3);
    });

    it('fall() снова помечает слой грязным — следующий draw() перестраивает path', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        const destCtx = makeDestCtx();
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        ground.fall(50, 10, 5);
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        expect(layerCtxMock.beginPath).toHaveBeenCalledTimes(2);
    });

    it('beginFrame() помечает слой грязным, только пока isFalling', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        const destCtx = makeDestCtx();
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        ground.beginFrame();
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        expect(layerCtxMock.beginPath).toHaveBeenCalledTimes(1);
    });

    it('draw() с частичным диапазоном тоже переиспользует закешированный слой', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        const destCtx = makeDestCtx();

        ground.draw(destCtx as unknown as CanvasRenderingContext2D, 10, 40);
        ground.draw(destCtx as unknown as CanvasRenderingContext2D, 60, 90);

        expect(layerCtxMock.beginPath).toHaveBeenCalledTimes(1);
        expect(destCtx.drawImage).toHaveBeenCalledTimes(2);
    });
});
