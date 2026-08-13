import { describe, expect, it, vi } from 'vitest';
import { CLOUD_LAYER_SPECS, SkyScene, type TSkyImages } from './sky-scene';

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
    far: fakeImage(1024, 200),
    near: fakeImage(1024, 240),
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

describe('SkyScene.update — движение слоёв', () => {
    it('двигает облачные слои по времени, каждый со своей скоростью (параллакс)', () => {
        const scene = new SkyScene({ seed: 1, reducedMotion: false });
        const before = scene.cloudOffsets();
        scene.update(100);
        const after = scene.cloudOffsets();
        after.forEach((offset, i) => expect(offset).not.toBe(before[i]));
        // Разные слои прошли разное расстояние — иначе это не параллакс.
        const deltas = after.map((offset, i) => offset - before[i]);
        expect(new Set(deltas).size).toBeGreaterThan(1);
    });

    it('prefers-reduced-motion: облака стоят на месте', () => {
        const scene = new SkyScene({ seed: 1, reducedMotion: true });
        const before = scene.cloudOffsets();
        scene.update(1000);
        expect(scene.cloudOffsets()).toEqual(before);
    });

    it('движение FPS-независимо: 2×16мс == 1×32мс', () => {
        const a = new SkyScene({ seed: 5, reducedMotion: false });
        const b = new SkyScene({ seed: 5, reducedMotion: false });
        a.update(16);
        a.update(16);
        b.update(32);
        a.cloudOffsets().forEach((offset, i) => expect(offset).toBeCloseTo(b.cloudOffsets()[i], 6));
    });

    it('один сид даёт то же положение облаков на старте', () => {
        const a = new SkyScene({ seed: 'daily-2026-08-13', reducedMotion: false });
        const b = new SkyScene({ seed: 'daily-2026-08-13', reducedMotion: false });
        expect(a.cloudOffsets()).toEqual(b.cloudOffsets());
    });

    it('число слоёв совпадает с конфигом', () => {
        const scene = new SkyScene({ seed: 1, reducedMotion: false });
        expect(scene.cloudOffsets()).toHaveLength(CLOUD_LAYER_SPECS.length);
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
        const images: TSkyImages = { far: fakeImage(1024, 200), near: fakeImage(1024, 240) };
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
