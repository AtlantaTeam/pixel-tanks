import { describe, expect, it, vi } from 'vitest';
import { SkyScene, type TSkyImages } from './sky-scene';

/**
 * Мини-заглушка 2D-контекста: happy-dom не рисует по canvas, поэтому проверяем,
 * что draw() дергает нужные примитивы (градиент, заливка, блит слоёв), а не пиксели.
 */
const createFakeCtx = () => {
    const gradient = { addColorStop: vi.fn() };
    return {
        canvas: { width: 800, height: 600 },
        createLinearGradient: vi.fn(() => gradient),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        scale: vi.fn(),
        setTransform: vi.fn(),
        beginPath: vi.fn(),
        fill: vi.fn(),
        set fillStyle(_v: unknown) {},
        get fillStyle() {
            return '#000';
        },
        set globalAlpha(_v: number) {},
        get globalAlpha() {
            return 1;
        },
        gradient,
    };
};

const fakeImage = (width: number, height: number) =>
    ({ width, height, complete: true, naturalWidth: width }) as unknown as HTMLImageElement;

const allImages = (): TSkyImages => ({
    mountains: fakeImage(1920, 300),
    cloud1: fakeImage(384, 174),
    cloud2: fakeImage(384, 241),
    cloud3: fakeImage(384, 232),
});

describe('SkyScene — выбор пресета', () => {
    it('берёт пресет по сиду, если явный не задан', () => {
        const a = new SkyScene({ seed: 42, reducedMotion: false });
        const b = new SkyScene({ seed: 42, reducedMotion: false });
        expect(a.preset.id).toBe(b.preset.id);
    });

    it('явный пресет перекрывает выбор по сиду (для витрины)', () => {
        const scene = new SkyScene({ seed: 42, reducedMotion: false, preset: 'night' });
        expect(scene.preset.id).toBe('night');
    });
});

describe('SkyScene.update — движение облаков', () => {
    it('копит время сцены — облака плывут', () => {
        const scene = new SkyScene({ seed: 1, reducedMotion: false });
        expect(scene.elapsedMs()).toBe(0);
        scene.update(100);
        expect(scene.elapsedMs()).toBe(100);
    });

    it('prefers-reduced-motion: время не идёт, облака стоят на месте', () => {
        const scene = new SkyScene({ seed: 1, reducedMotion: true });
        scene.update(1000);
        expect(scene.elapsedMs()).toBe(0);
    });

    it('движение FPS-независимо: 2×16мс == 1×32мс', () => {
        const a = new SkyScene({ seed: 5, reducedMotion: false });
        const b = new SkyScene({ seed: 5, reducedMotion: false });
        a.update(16);
        a.update(16);
        b.update(32);
        expect(a.elapsedMs()).toBeCloseTo(b.elapsedMs(), 6);
    });

    it('один сид даёт то же небо на старте', () => {
        const a = new SkyScene({ seed: 'daily-2026-08-13', reducedMotion: false });
        const b = new SkyScene({ seed: 'daily-2026-08-13', reducedMotion: false });
        a.resize(1280, 800);
        b.resize(1280, 800);
        expect(a.cloudField()).toEqual(b.cloudField());
    });

    it('соседние облака плывут с разными скоростями — это и есть параллакс', () => {
        const scene = new SkyScene({ seed: 1, reducedMotion: false });
        scene.resize(1280, 800);
        expect(new Set(scene.cloudField().map((c) => c.speed)).size).toBeGreaterThan(1);
    });
});

describe('SkyScene.resize / draw', () => {
    it('resize помечает статичный слой на перерисовку', () => {
        const scene = new SkyScene({ seed: 1, reducedMotion: false });
        const ctx = createFakeCtx();
        expect(scene.isStaticDirty()).toBe(true);
        scene.resize(800, 600);
        expect(scene.isStaticDirty()).toBe(true);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(scene.isStaticDirty()).toBe(false);
    });

    it('перестраивает статичный слой только при resize, между кадрами лишь блитит кеш', () => {
        const offscreenCtx = createFakeCtx();
        const offscreen = {
            width: 0,
            height: 0,
            getContext: () => offscreenCtx,
        } as unknown as HTMLCanvasElement;
        const scene = new SkyScene({
            seed: 1,
            reducedMotion: false,
            images: allImages(),
            createCanvas: () => offscreen,
        });
        const ctx = createFakeCtx();
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        // Небо построено на offscreen ровно один раз на два кадра.
        expect(offscreenCtx.createLinearGradient).toHaveBeenCalledTimes(1);
        scene.resize(400, 300);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        // Ресайз — единственный повод перестроить статичный слой заново.
        expect(offscreenCtx.createLinearGradient).toHaveBeenCalledTimes(2);
    });

    it('draw заливает небо градиентом даже без арта', () => {
        const scene = new SkyScene({ seed: 1, reducedMotion: false });
        const ctx = createFakeCtx();
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(ctx.createLinearGradient).toHaveBeenCalled();
        expect(ctx.gradient.addColorStop).toHaveBeenCalled();
        expect(ctx.fillRect).toHaveBeenCalled();
    });

    it('draw блитит облачные слои, когда арт передан', () => {
        const scene = new SkyScene({ seed: 1, reducedMotion: false, images: allImages() });
        const ctx = createFakeCtx();
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(ctx.drawImage).toHaveBeenCalled();
    });

    it('draw не падает без арта и без предварительного resize', () => {
        const scene = new SkyScene({ seed: 1, reducedMotion: false });
        const ctx = createFakeCtx();
        expect(() => scene.draw(ctx as unknown as CanvasRenderingContext2D)).not.toThrow();
    });

    it('markStaticDirty перестраивает статичный слой — поздно догруженные горы попадают в кеш', () => {
        const offscreenCtx = createFakeCtx();
        const offscreen = {
            width: 0,
            height: 0,
            getContext: () => offscreenCtx,
        } as unknown as HTMLCanvasElement;
        // На первом кадре гор ещё нет (спрайт долетает асинхронно).
        const images: TSkyImages = { cloud1: fakeImage(384, 174), cloud2: fakeImage(384, 241) };
        const scene = new SkyScene({
            seed: 1,
            reducedMotion: false,
            images,
            createCanvas: () => offscreen,
        });
        const ctx = createFakeCtx();
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(offscreenCtx.createLinearGradient).toHaveBeenCalledTimes(1);

        // Горы догрузились. Без инвалидации кеш возвращается как есть — слой не перестраивается.
        images.mountains = fakeImage(1920, 300);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(offscreenCtx.createLinearGradient).toHaveBeenCalledTimes(1);

        // markStaticDirty форсирует перестройку — теперь горы попадают в кеш.
        scene.markStaticDirty();
        expect(scene.isStaticDirty()).toBe(true);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(offscreenCtx.createLinearGradient).toHaveBeenCalledTimes(2);
    });

    it('плотность облаков зависит от ширины, а не от высоты канваса (#510, #514)', () => {
        // Поворот телефона не должен переставлять и перекраивать небо: при той же
        // ширине поле остаётся прежним.
        const scene = new SkyScene({ seed: 1, reducedMotion: false, images: allImages() });
        scene.resize(390, 844);
        const tall = scene.cloudField();
        scene.resize(390, 500);
        expect(scene.cloudField()).toEqual(tall);
        // Шире экран — больше облаков.
        scene.resize(1280, 800);
        expect(scene.cloudField().length).toBeGreaterThan(tall.length);
    });

    it('видимый размер облака одинаков при любой плотности экрана (#510, #514)', () => {
        const original = window.devicePixelRatio;
        Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
        try {
            const images = allImages();
            const scene = new SkyScene({ seed: 1, reducedMotion: false, images });
            const ctx = createFakeCtx();
            scene.resize(1280, 800);
            scene.draw(ctx as unknown as CanvasRenderingContext2D);
            const cloudCalls = ctx.drawImage.mock.calls.filter(
                (c) => c[0] === images.cloud1 || c[0] === images.cloud2 || c[0] === images.cloud3,
            ) as unknown as number[][];
            expect(cloudCalls.length).toBeGreaterThan(0);
            for (const call of cloudCalls) {
                // Спрайт 384 арт-px → 192 CSS-px, как в одобренном кадре.
                expect(call[3]).toBe(192);
            }
        } finally {
            Object.defineProperty(window, 'devicePixelRatio', {
                value: original,
                configurable: true,
            });
        }
    });

    it('позиции квантованы по пикселям устройства — арт не кипит на ходу (#514)', () => {
        // При дробной позиции канвас каждый кадр пересэмплирует спрайт по-новому:
        // пиксельная сетка «передёргивается» на глазах.
        const original = window.devicePixelRatio;
        Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
        try {
            const images = allImages();
            const scene = new SkyScene({ seed: 3, reducedMotion: false, images });
            const ctx = createFakeCtx();
            scene.resize(1280, 800);
            scene.update(37.4);
            scene.draw(ctx as unknown as CanvasRenderingContext2D);
            const cloudCalls = ctx.drawImage.mock.calls.filter(
                (c) => c[0] === images.cloud1 || c[0] === images.cloud2 || c[0] === images.cloud3,
            ) as unknown as number[][];
            expect(cloudCalls.length).toBeGreaterThan(0);
            for (const call of cloudCalls) {
                // abs: у облака, наполовину уехавшего за левый край, координата
                // отрицательная, и остаток даёт -0 — а `Object.is(-0, 0)` ложь.
                expect(Math.abs((call[1] * 2) % 1)).toBe(0);
                expect(Math.abs((call[2] * 2) % 1)).toBe(0);
            }
        } finally {
            Object.defineProperty(window, 'devicePixelRatio', {
                value: original,
                configurable: true,
            });
        }
    });

    it('без offscreen не аллоцирует канвас на каждый кадр (запоминает недоступность)', () => {
        let created = 0;
        const noCtxCanvas = {
            width: 0,
            height: 0,
            getContext: () => null,
        } as unknown as HTMLCanvasElement;
        const scene = new SkyScene({
            seed: 1,
            reducedMotion: false,
            createCanvas: () => {
                created += 1;
                return noCtxCanvas;
            },
        });
        const ctx = createFakeCtx();
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        // Канвас создан ровно один раз: недоступность offscreen запомнена, не пере-создаётся.
        expect(created).toBe(1);
    });
});
