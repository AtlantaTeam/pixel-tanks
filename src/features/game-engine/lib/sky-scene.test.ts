import { describe, expect, it, vi } from 'vitest';
import { cloudSpriteWidth, CLOUD_SCALE_MAX, MOUNTAIN_HORIZON_FRAC } from './cloud-field';
import { SkyScene, type TSkyImages } from './sky-scene';

/**
 * Мини-заглушка 2D-контекста: happy-dom не рисует по canvas, поэтому проверяем,
 * что draw() дергает нужные примитивы (градиент, заливка, блит слоёв), а не пиксели.
 */
const createFakeCtx = () => {
    const gradient = { addColorStop: vi.fn() };
    const radialGradient = { addColorStop: vi.fn() };
    return {
        canvas: { width: 800, height: 600 },
        createLinearGradient: vi.fn(() => gradient),
        createRadialGradient: vi.fn(() => radialGradient),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        scale: vi.fn(),
        setTransform: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
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
        radialGradient,
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

    it('размер облака — из масштаба мира, а не доли ширины экрана (#572)', () => {
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
            const baseWidth = cloudSpriteWidth(1280);
            for (const call of cloudCalls) {
                // Каждое облако домножает базовую (масштаб мира) величину на свой scale,
                // выведенный из высоты (#572) — потолок держит `CLOUD_SCALE_MAX`.
                expect(Math.abs(call[3])).toBeGreaterThan(0);
                expect(Math.abs(call[3])).toBeLessThanOrEqual(
                    Math.round(baseWidth * CLOUD_SCALE_MAX),
                );
            }

            // Облако на 1920 и 2560 одного размера — масштаб мира упёрся в потолок,
            // а не растёт с шириной (в отличие от прежней доли 0.15).
            expect(cloudSpriteWidth(1920)).toBe(cloudSpriteWidth(2560));
        } finally {
            Object.defineProperty(window, 'devicePixelRatio', {
                value: original,
                configurable: true,
            });
        }
    });

    it('облако не заходит низом за силуэт дальних гор (#572)', () => {
        const images = allImages();
        // Много сидов: на одном поле низкого облака у самого горизонта может не выпасть.
        for (let seed = 0; seed < 30; seed++) {
            const scene = new SkyScene({ seed, reducedMotion: false, images });
            const ctx = createFakeCtx();
            const height = 800;
            scene.resize(1280, height);
            scene.draw(ctx as unknown as CanvasRenderingContext2D);
            const cloudCalls = ctx.drawImage.mock.calls.filter(
                (c) => c[0] === images.cloud1 || c[0] === images.cloud2 || c[0] === images.cloud3,
            ) as unknown as number[][];
            for (const call of cloudCalls) {
                const y = call[2];
                const spriteHeight = Math.abs(call[4]);
                // Низ облака (y + высота) не пересекает линию гор (+1 px на квантование).
                expect(y + spriteHeight).toBeLessThanOrEqual(height * MOUNTAIN_HORIZON_FRAC + 1);
            }
        }
    });

    it('облако у горизонта сплюснуто по вертикали сильнее, чем у верха кадра (#572)', () => {
        const images = allImages();
        const scene = new SkyScene({ seed: 1, reducedMotion: false, images });
        scene.resize(1280, 800);
        const field = scene.cloudField();
        const ctx = createFakeCtx();
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        const cloudCalls = ctx.drawImage.mock.calls.filter(
            (c) => c[0] === images.cloud1 || c[0] === images.cloud2 || c[0] === images.cloud3,
        ) as unknown as number[][];
        expect(cloudCalls.length).toBe(field.length);
        // Отношение нарисованной высоты к «неспл­ющенной» (по ширине и пропорции спрайта)
        // должно повторять squashY облака: у горизонта заметно меньше 1.
        field.forEach((cloud, i) => {
            const image = images[cloud.sprite]!;
            const spriteWidth = Math.abs(cloudCalls[i][3]);
            const unsquashed = (image.height * spriteWidth) / image.width;
            const drawnHeight = Math.abs(cloudCalls[i][4]);
            expect(drawnHeight).toBe(Math.max(1, Math.round(unsquashed * cloud.squashY)));
        });
    });

    it('облако у горизонта рисуется бледнее — воздушная дымка (#572)', () => {
        const images = allImages();
        const scene = new SkyScene({ seed: 1, reducedMotion: false, images, preset: 'day' });
        // Захватываем globalAlpha в момент каждого drawImage облака.
        const alphas: number[] = [];
        let current = 1;
        const ctx = {
            ...createFakeCtx(),
            set globalAlpha(v: number) {
                current = v;
            },
            get globalAlpha() {
                return current;
            },
            drawImage: vi.fn((img: unknown) => {
                if (img === images.cloud1 || img === images.cloud2 || img === images.cloud3) {
                    alphas.push(current);
                }
            }),
        };
        scene.resize(1280, 800);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        const field = scene.cloudField();
        // Порядок drawImage совпадает с порядком поля.
        const lowest = field.reduce((a, b) => (b.yFrac > a.yFrac ? b : a));
        const highest = field.reduce((a, b) => (b.yFrac < a.yFrac ? b : a));
        const lowIdx = field.indexOf(lowest);
        const highIdx = field.indexOf(highest);
        expect(alphas[lowIdx]).toBeLessThan(alphas[highIdx]);
    });

    it('облака поля заметно разного размера на 1280 — не единый масштаб на все (#515)', () => {
        const images = allImages();
        const scene = new SkyScene({ seed: 1, reducedMotion: false, images });
        const ctx = createFakeCtx();
        scene.resize(1280, 800);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        const field = scene.cloudField();
        const cloudCalls = ctx.drawImage.mock.calls.filter(
            (c) => c[0] === images.cloud1 || c[0] === images.cloud2 || c[0] === images.cloud3,
        ) as unknown as number[][];
        expect(cloudCalls.length).toBe(field.length);

        const baseWidth = cloudSpriteWidth(1280);
        field.forEach((cloud, i) => {
            const expectedWidth = Math.round(baseWidth * cloud.scale);
            expect(Math.abs(cloudCalls[i][3])).toBe(expectedWidth);
            // Отрицательная ширина назначения — контракт зеркалирования по X.
            expect(cloudCalls[i][3] < 0).toBe(cloud.mirror);
        });

        const widths = new Set(cloudCalls.map((c) => Math.abs(c[3])));
        expect(widths.size).toBeGreaterThan(1);
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

    it('шаги облака равномерны при дрожащем dt — не «тормоз-газ» (#515)', () => {
        // Кадры прилетают неровно (rAF гуляет). Если округлять ПОЗИЦИЮ, границы пикселя
        // пересекаются как попало: два шага подряд, потом пауза. Каданс должен зависеть
        // только от накопленного времени, а не от того, как оно нарезано на кадры.
        const original = window.devicePixelRatio;
        Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
        try {
            const images = allImages();
            const jittery = new SkyScene({ seed: 7, reducedMotion: false, images });
            const even = new SkyScene({ seed: 7, reducedMotion: false, images });
            jittery.resize(1280, 800);
            even.resize(1280, 800);

            const xsOf = (scene: SkyScene) => {
                const ctx = createFakeCtx();
                scene.draw(ctx as unknown as CanvasRenderingContext2D);
                return (
                    ctx.drawImage.mock.calls.filter(
                        (c) => c[0] !== undefined,
                    ) as unknown as number[][]
                ).map((c) => c[1]);
            };

            // Одно и то же суммарное время, нарезанное по-разному.
            [3, 41, 7, 29, 60, 10].forEach((dt) => jittery.update(dt));
            even.update(150);
            expect(xsOf(jittery)).toEqual(xsOf(even));
        } finally {
            Object.defineProperty(window, 'devicePixelRatio', {
                value: original,
                configurable: true,
            });
        }
    });

    it('интервалы между шагами облака одинаковы (#515)', () => {
        const original = window.devicePixelRatio;
        Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
        try {
            const images = allImages();
            const scene = new SkyScene({ seed: 11, reducedMotion: false, images });
            scene.resize(1280, 800);
            // Именно облако, а не горы: горы неподвижны и первыми уходят в drawImage.
            const cloudSprites = [images.cloud1, images.cloud2, images.cloud3];
            const firstX = () => {
                const ctx = createFakeCtx();
                scene.draw(ctx as unknown as CanvasRenderingContext2D);
                const call = ctx.drawImage.mock.calls.find((c) =>
                    cloudSprites.includes(c[0] as HTMLImageElement),
                ) as unknown as number[];
                return call[1];
            };

            // Ловим моменты, когда самое быстрое облако сдвигается, и сверяем интервалы.
            const stepTimes: number[] = [];
            let previous = firstX();
            for (let t = 1; t <= 2000; t++) {
                scene.update(1);
                const current = firstX();
                if (current !== previous) {
                    stepTimes.push(t);
                    previous = current;
                }
            }
            expect(stepTimes.length).toBeGreaterThan(3);
            const gaps = stepTimes.slice(1).map((t, i) => t - stepTimes[i]);
            // Разброс интервалов — не больше миллисекунды (округление до целого тика).
            expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
        } finally {
            Object.defineProperty(window, 'devicePixelRatio', {
                value: original,
                configurable: true,
            });
        }
    });

    it('облака плывут в сторону ветра боя (#518)', () => {
        const images = allImages();
        const cloudSprites = [images.cloud1, images.cloud2, images.cloud3];
        const firstXAfter = (wind: number, ms: number) => {
            const scene = new SkyScene({ seed: 21, reducedMotion: false, wind, images });
            scene.resize(1280, 800);
            scene.update(ms);
            const ctx = createFakeCtx();
            scene.draw(ctx as unknown as CanvasRenderingContext2D);
            const call = ctx.drawImage.mock.calls.find((c) =>
                cloudSprites.includes(c[0] as HTMLImageElement),
            ) as unknown as number[];
            return call[1];
        };

        const start = firstXAfter(0.01, 0);
        expect(firstXAfter(0.01, 3000)).toBeGreaterThan(start);
        expect(firstXAfter(-0.01, 3000)).toBeLessThan(start);
    });

    it('при штиле облака всё равно дрейфуют — небо не замирает (#518)', () => {
        const images = allImages();
        const cloudSprites = [images.cloud1, images.cloud2, images.cloud3];
        const scene = new SkyScene({ seed: 21, reducedMotion: false, wind: 0, images });
        scene.resize(1280, 800);
        const xNow = () => {
            const ctx = createFakeCtx();
            scene.draw(ctx as unknown as CanvasRenderingContext2D);
            const call = ctx.drawImage.mock.calls.find((c) =>
                cloudSprites.includes(c[0] as HTMLImageElement),
            ) as unknown as number[];
            return call[1];
        };
        const before = xNow();
        scene.update(10000);
        expect(xNow()).not.toBe(before);
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

describe('SkyScene — светило и звёзды (#519)', () => {
    it('один сид даёт то же положение светила и звёзд', () => {
        const a = new SkyScene({ seed: 'daily-2026-08-13', reducedMotion: false, preset: 'night' });
        const b = new SkyScene({ seed: 'daily-2026-08-13', reducedMotion: false, preset: 'night' });
        a.resize(1280, 800);
        b.resize(1280, 800);
        expect(a.celestialGeometry()).toEqual(b.celestialGeometry());
        expect(a.starField()).toEqual(b.starField());
    });

    it('разные сиды разносят светило по-разному', () => {
        const a = new SkyScene({ seed: 'seed-a', reducedMotion: false, preset: 'day' });
        const b = new SkyScene({ seed: 'seed-b', reducedMotion: false, preset: 'day' });
        expect(a.celestialGeometry()).not.toEqual(b.celestialGeometry());
    });

    it('днём солнце стоит высоко в разумном секторе неба', () => {
        for (let seed = 0; seed < 20; seed++) {
            const scene = new SkyScene({ seed, reducedMotion: false, preset: 'day' });
            const cel = scene.celestialGeometry();
            expect(cel.xFrac).toBeGreaterThanOrEqual(0.14);
            expect(cel.xFrac).toBeLessThanOrEqual(0.86);
            expect(cel.yFrac).toBeGreaterThanOrEqual(0.26);
            expect(cel.yFrac).toBeLessThanOrEqual(0.4);
        }
    });

    it('на закате солнце ниже (у горизонта) и крупнее дневного', () => {
        for (let seed = 0; seed < 20; seed++) {
            const day = new SkyScene({ seed, reducedMotion: false, preset: 'day' });
            const sunset = new SkyScene({ seed, reducedMotion: false, preset: 'sunset' });
            expect(sunset.celestialGeometry().yFrac).toBeGreaterThan(day.celestialGeometry().yFrac);
            expect(sunset.celestialGeometry().radiusFrac).toBeGreaterThan(
                day.celestialGeometry().radiusFrac,
            );
        }
    });

    it('только ночной пресет несёт звёзды — день и закат без них', () => {
        const day = new SkyScene({ seed: 1, reducedMotion: false, preset: 'day' });
        const sunset = new SkyScene({ seed: 1, reducedMotion: false, preset: 'sunset' });
        const night = new SkyScene({ seed: 1, reducedMotion: false, preset: 'night' });
        day.resize(1280, 800);
        sunset.resize(1280, 800);
        night.resize(1280, 800);
        expect(day.starField()).toHaveLength(0);
        expect(sunset.starField()).toHaveLength(0);
        expect(night.starField().length).toBeGreaterThan(0);
    });

    it('звёзды разбросаны выше силуэта гор', () => {
        const night = new SkyScene({ seed: 3, reducedMotion: false, preset: 'night' });
        night.resize(1280, 800);
        for (const star of night.starField()) {
            expect(star.yFrac).toBeGreaterThanOrEqual(0);
            expect(star.yFrac).toBeLessThanOrEqual(0.56);
        }
    });

    it('плотность звёзд растёт с шириной экрана', () => {
        const narrow = new SkyScene({ seed: 5, reducedMotion: false, preset: 'night' });
        const wide = new SkyScene({ seed: 5, reducedMotion: false, preset: 'night' });
        narrow.resize(390, 844);
        wide.resize(1920, 1080);
        expect(wide.starField().length).toBeGreaterThan(narrow.starField().length);
    });

    it('светило рисуется в статичном слое: не перестраивается между кадрами', () => {
        const offscreenCtx = createFakeCtx();
        const offscreen = {
            width: 0,
            height: 0,
            getContext: () => offscreenCtx,
        } as unknown as HTMLCanvasElement;
        const scene = new SkyScene({
            seed: 1,
            reducedMotion: false,
            preset: 'day',
            createCanvas: () => offscreen,
        });
        const ctx = createFakeCtx();
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        const callsAfterFirstDraw = offscreenCtx.arc.mock.calls.length;
        expect(callsAfterFirstDraw).toBeGreaterThan(0);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        // Второй кадр не трогает offscreen вовсе — светило не перерисовывается.
        expect(offscreenCtx.arc.mock.calls.length).toBe(callsAfterFirstDraw);
        scene.resize(400, 300);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        // Ресайз — единственный повод перестроить светило заново.
        expect(offscreenCtx.arc.mock.calls.length).toBeGreaterThan(callsAfterFirstDraw);
    });

    it('солнце и луна рисуются примитивами Canvas, без растровых image-спрайтов', () => {
        // Критерий issue #519: программно, как взрыв, — растр не заводить.
        for (const preset of ['day', 'sunset', 'night'] as const) {
            const scene = new SkyScene({ seed: 7, reducedMotion: false, preset });
            const ctx = createFakeCtx();
            scene.resize(800, 600);
            scene.draw(ctx as unknown as CanvasRenderingContext2D);
            expect(ctx.arc).toHaveBeenCalled();
        }
    });
});

describe('SkyScene — контур гор от светила (#545)', () => {
    it('при доступном offscreen блитит силуэт гор с контуром каймы для всех пресетов', () => {
        for (const preset of ['day', 'sunset', 'night'] as const) {
            const offscreenCtx = createFakeCtx();
            const offscreen = {
                width: 0,
                height: 0,
                getContext: () => offscreenCtx,
            } as unknown as HTMLCanvasElement;
            const scene = new SkyScene({
                seed: 3,
                reducedMotion: false,
                preset,
                images: allImages(),
                createCanvas: () => offscreen,
            });
            const ctx = createFakeCtx();
            scene.resize(800, 600);
            // Контурная ветка (ensureEdgeMountain + сдвинутый силуэт) отрабатывает без падения.
            expect(() => scene.draw(ctx as unknown as CanvasRenderingContext2D)).not.toThrow();
            // Силуэт гор блитится на статичный слой (основной + контур каймы).
            expect(offscreenCtx.drawImage).toHaveBeenCalled();
        }
    });
});
