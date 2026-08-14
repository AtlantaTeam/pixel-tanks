import { describe, expect, it } from 'vitest';
import { MAX_WIND } from './wind';
import { WindDust } from './wind-dust-scene';

/**
 * Заглушка 2D-контекста: happy-dom не рисует пиксели, поэтому проверяем, что draw()
 * зовёт `fillRect` нужное число раз и с какой альфой (`globalAlpha` на момент вызова).
 */
const createFakeCtx = () => {
    let alpha = 1;
    const fills: { x: number; y: number; w: number; h: number; alpha: number }[] = [];
    return {
        canvas: { width: 800, height: 600 },
        clearRect: () => {},
        fillRect: (x: number, y: number, w: number, h: number) => {
            fills.push({ x, y, w, h, alpha });
        },
        save: () => {},
        restore: () => {},
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

describe('WindDust — днём (#550)', () => {
    it('wind = 0 → ничего не рисует (пылинок нет)', () => {
        const ctx = createFakeCtx();
        const scene = new WindDust({ seed: 1, wind: 0, isNight: false, reducedMotion: false });
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(ctx.fills).toHaveLength(0);
    });

    it('ветер есть → рисует по частице на каждую пылинку поля', () => {
        const ctx = createFakeCtx();
        const scene = new WindDust({
            seed: 1,
            wind: MAX_WIND,
            isNight: false,
            reducedMotion: false,
        });
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(ctx.fills.length).toBe(scene.dustField().length);
        expect(ctx.fills.length).toBeGreaterThan(0);
    });

    it('reduced-motion — частиц не рисует (тот же приём, что осадки #546/#547)', () => {
        const ctx = createFakeCtx();
        const scene = new WindDust({
            seed: 1,
            wind: MAX_WIND,
            isNight: false,
            reducedMotion: true,
        });
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(ctx.fills).toHaveLength(0);
    });
});

describe('WindDust — ночью (#550): подсветка кромки вместо пылинок', () => {
    it('ветер есть → рисует ровно одну полосу подсветки, не отдельные пылинки', () => {
        const ctx = createFakeCtx();
        const scene = new WindDust({
            seed: 1,
            wind: MAX_WIND,
            isNight: true,
            reducedMotion: false,
        });
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(ctx.fills).toHaveLength(1);
        expect(ctx.fills[0].w).toBe(800);
        expect(ctx.fills[0].h).toBe(1);
    });

    it('wind = 0 → подсветки тоже нет', () => {
        const ctx = createFakeCtx();
        const scene = new WindDust({ seed: 1, wind: 0, isNight: true, reducedMotion: false });
        scene.resize(800, 600);
        scene.draw(ctx as unknown as CanvasRenderingContext2D);
        expect(ctx.fills).toHaveLength(0);
    });

    it('сильнее ветер → ярче подсветка', () => {
        const ctxWeak = createFakeCtx();
        const weak = new WindDust({
            seed: 1,
            wind: MAX_WIND / 3,
            isNight: true,
            reducedMotion: false,
        });
        weak.resize(800, 600);
        weak.draw(ctxWeak as unknown as CanvasRenderingContext2D);

        const ctxStrong = createFakeCtx();
        const strong = new WindDust({
            seed: 1,
            wind: MAX_WIND,
            isNight: true,
            reducedMotion: false,
        });
        strong.resize(800, 600);
        strong.draw(ctxStrong as unknown as CanvasRenderingContext2D);

        expect(ctxStrong.fills[0].alpha).toBeGreaterThan(ctxWeak.fills[0].alpha);
    });
});

describe('WindDust — детерминизм (#550)', () => {
    it('тот же сид — то же поле частиц', () => {
        const a = new WindDust({ seed: 42, wind: MAX_WIND, isNight: false, reducedMotion: false });
        const b = new WindDust({ seed: 42, wind: MAX_WIND, isNight: false, reducedMotion: false });
        expect(a.dustField()).toEqual(b.dustField());
    });
});
