import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { computeTerrainHeights, type TArenaInsets } from './arena-insets';
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

describe('Ground: рельеф внутри свободной зоны (safe-зона, #454)', () => {
    const INSETS: TArenaInsets = { top: 140, bottom: 150 };

    it('явно пустые инсеты дают тот же рельеф, что и без аргумента', () => {
        const withArg = new Ground(WIDTH, HEIGHT, createSeededRandom(42), undefined, {
            top: 0,
            bottom: 0,
        });
        const withoutArg = new Ground(WIDTH, HEIGHT, createSeededRandom(42));

        expect(withArg.heights).toEqual(withoutArg.heights);
    });

    it('детерминирован по seed и при непустых инсетах', () => {
        const first = new Ground(WIDTH, HEIGHT, createSeededRandom(7), undefined, INSETS);
        const second = new Ground(WIDTH, HEIGHT, createSeededRandom(7), undefined, INSETS);

        expect(first.heights).toEqual(second.heights);
    });

    it('поднимает рельеф в зону: поверхность не под палубой и не под HUD', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(2026), undefined, INSETS);
        const zoneTopY = INSETS.top;
        const deckTopY = HEIGHT - INSETS.bottom;

        ground.heights.forEach((h) => {
            const surfaceY = HEIGHT - h;
            // Ни одна точка поверхности не уходит под палубу (ниже её верха) и не
            // залезает под HUD (выше верха зоны).
            expect(surfaceY).toBeLessThanOrEqual(deckTopY);
            expect(surfaceY).toBeGreaterThanOrEqual(zoneTopY);
        });
    });

    it('инсеты сдвигают рельеф вверх относительно поведения без safe-зоны', () => {
        const full = new Ground(WIDTH, HEIGHT, createSeededRandom(99));
        const zoned = new Ground(WIDTH, HEIGHT, createSeededRandom(99), undefined, INSETS);

        // При поднятой базовой линии низины (минимальная высота) выше, чем без зоны.
        expect(Math.min(...zoned.heights)).toBeGreaterThan(Math.min(...full.heights));
    });
});

describe('Ground.resize: перекладка рельефа в зону при смене размера канваса', () => {
    it('после ресайза с инсетами рельеф остаётся внутри полосы новой высоты', () => {
        const insets: TArenaInsets = { top: 120, bottom: 140 };
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(7), undefined, insets);

        ground.resize(WIDTH, 500);

        const band = computeTerrainHeights(500, insets);
        ground.heights.forEach((h) => {
            // ±1 — дрейф floor при линейном переносе профиля в новую полосу.
            expect(h).toBeGreaterThanOrEqual(Math.floor(band.min) - 1);
            expect(h).toBeLessThanOrEqual(Math.ceil(band.max) + 1);
        });
    });
});

const makeLayerCtx = () => ({
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
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

    it('тонировка (#545) заливает силуэт рельефа через source-atop по числу слоёв', () => {
        const tint = [
            { color: '#d9713e', alpha: 0.3 },
            { color: '#c900ff', alpha: 0.08 },
        ];
        const ground = new Ground(100, 100, createSeededRandom(1), undefined, undefined, tint);
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
        // По одному fillRect на слой тонировки, композит — source-atop (только песок).
        expect(layerCtxMock.fillRect).toHaveBeenCalledTimes(tint.length);
        expect(layerCtxMock.globalCompositeOperation).toBe('source-atop');
    });

    it('без тонировки (день) source-atop-заливки нет', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
        expect(layerCtxMock.fillRect).not.toHaveBeenCalled();
    });

    it('подсветка кромки (#545) рисует линию по верху рельефа тоном каймы', () => {
        const ground = new Ground(
            100,
            100,
            createSeededRandom(1),
            undefined,
            undefined,
            [],
            '#ffb066',
        );
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
        // Крест-линия строит path (beginPath: рельеф + кромка) и штрихует её.
        expect(layerCtxMock.beginPath).toHaveBeenCalledTimes(2);
        expect(layerCtxMock.stroke).toHaveBeenCalledTimes(2);
    });
});
