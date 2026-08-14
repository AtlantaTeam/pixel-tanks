import { describe, expect, it, vi } from 'vitest';
import { Precipitation } from './precipitation-scene';

/**
 * Заглушка 2D-контекста: happy-dom не рисует пиксели, поэтому проверяем, что draw()
 * зовёт нужные примитивы, и запоминаем `globalAlpha`, с которой рисуется каждая частица
 * (`fillRect`) — из неё видно гашение на прицеливании.
 */
const createFakeCtx = () => {
    let alpha = 1;
    const fills: { alpha: number }[] = [];
    return {
        canvas: { width: 800, height: 600 },
        clearRect: vi.fn(),
        fillRect: vi.fn(() => {
            fills.push({ alpha });
        }),
        save: vi.fn(),
        restore: vi.fn(),
        set fillStyle(_v: unknown) {},
        get fillStyle() {
            return '#000';
        },
        set globalAlpha(v: number) {
            alpha = v;
        },
        get globalAlpha() {
            return alpha;
        },
        fills,
    };
};

/** Сид, дающий дождь (проверено через pickPrecipPreset в precipitation.test.ts). */
const rainySeed = (): number => {
    // Ищем детерминированно первый сид с осадками — тест не зависит от «магического» числа.
    for (let seed = 0; seed < 100; seed++) {
        const scene = new Precipitation({ seed, reducedMotion: false });
        if (scene.preset.id === 'rain') return seed;
    }
    throw new Error('дождливый сид не найден');
};

describe('Precipitation — выбор пресета', () => {
    it('берёт пресет по сиду, если явный не задан', () => {
        const a = new Precipitation({ seed: 42, reducedMotion: false });
        const b = new Precipitation({ seed: 42, reducedMotion: false });
        expect(a.preset.id).toBe(b.preset.id);
    });

    it('явный пресет перекрывает выбор по сиду (для витрины)', () => {
        const scene = new Precipitation({ seed: 42, reducedMotion: false, preset: 'snow' });
        expect(scene.preset.id).toBe('snow');
    });
});

describe('Precipitation.update — движение', () => {
    it('копит время сцены', () => {
        const scene = new Precipitation({ seed: rainySeed(), reducedMotion: false });
        expect(scene.elapsedMs()).toBe(0);
        scene.update(100);
        scene.update(50);
        expect(scene.elapsedMs()).toBe(150);
    });

    it('при reduced-motion время не копится (частиц нет)', () => {
        const scene = new Precipitation({ seed: rainySeed(), reducedMotion: true });
        scene.update(1000);
        expect(scene.elapsedMs()).toBe(0);
    });
});

describe('Precipitation.resize — плотность от ширины', () => {
    it('поле пересобирается при смене ширины', () => {
        const scene = new Precipitation({ seed: rainySeed(), reducedMotion: false });
        scene.resize(390, 800);
        const narrow = scene.precipField().length;
        scene.resize(1280, 800);
        const wide = scene.precipField().length;
        expect(wide).toBeGreaterThan(narrow);
    });
});

describe('Precipitation.draw', () => {
    it('рисует частицы дождя', () => {
        const scene = new Precipitation({ seed: rainySeed(), reducedMotion: false });
        scene.resize(1280, 800);
        const ctx = createFakeCtx();
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(ctx.fills.length).toBeGreaterThan(0);
    });

    it('гашение на прицеливании: частицы рисуются с меньшей альфой', () => {
        const scene = new Precipitation({ seed: rainySeed(), reducedMotion: false });
        scene.resize(1280, 800);

        const bright = createFakeCtx();
        scene.setDimmed(false);
        scene.draw(bright as unknown as CanvasRenderingContext2D);
        const brightAvg = bright.fills.reduce((s, f) => s + f.alpha, 0) / bright.fills.length;

        const dim = createFakeCtx();
        scene.setDimmed(true);
        scene.draw(dim as unknown as CanvasRenderingContext2D);
        const dimAvg = dim.fills.reduce((s, f) => s + f.alpha, 0) / dim.fills.length;

        expect(dimAvg).toBeLessThan(brightAvg);
    });

    it('clear не рисует частиц', () => {
        // Сид, дающий clear.
        let clearSeed = -1;
        for (let seed = 0; seed < 100; seed++) {
            if (new Precipitation({ seed, reducedMotion: false }).preset.id === 'clear') {
                clearSeed = seed;
                break;
            }
        }
        expect(clearSeed).toBeGreaterThanOrEqual(0);
        const scene = new Precipitation({ seed: clearSeed, reducedMotion: false });
        scene.resize(1280, 800);
        const ctx = createFakeCtx();
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(ctx.fills.length).toBe(0);
    });

    it('reduced-motion: движущихся частиц нет', () => {
        const scene = new Precipitation({ seed: rainySeed(), reducedMotion: true });
        scene.resize(1280, 800);
        scene.update(5000);
        const ctx = createFakeCtx();
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        // Дождь без дымки — ни одной частицы (тонировку рельефа кладёт Ground, не слой).
        expect(ctx.fills.length).toBe(0);
    });

    it('reduced-motion + буря: одна статичная дымка на весь кадр', () => {
        const scene = new Precipitation({ seed: 1, reducedMotion: true, preset: 'sandstorm' });
        scene.resize(1280, 800);
        const ctx = createFakeCtx();
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        // Ровно один fillRect — дымка, а не поток частиц.
        expect(ctx.fills.length).toBe(1);
    });

    it('нулевой размер — ничего не рисует, без падения', () => {
        const scene = new Precipitation({ seed: rainySeed(), reducedMotion: false });
        const ctx = { ...createFakeCtx(), canvas: { width: 0, height: 0 } };
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(ctx.fills.length).toBe(0);
    });
});
