import { getDevicePixelRatio, snapToDevicePixel } from '@/shared/lib/canvas';
import {
    buildPrecipField,
    pickPrecipPreset,
    pickPrecipPresetById,
    precipAlphaScale,
    precipWindNorm,
    type TPrecipParticle,
    type TPrecipPreset,
    type TPrecipPresetId,
} from './precipitation';

type TPrecipitationOptions = {
    seed: number | string;
    /** Ветер боя (`px/тик²`, как `GamePlay.wind`): знак — сторона сноса, модуль — сила. */
    wind?: number;
    reducedMotion: boolean;
    /** Явный пресет — для витрины. Иначе выбирается по сиду. */
    preset?: TPrecipPresetId;
};

/** Заворачивает долю в [0, 1) — частица, уехавшая за край кадра, въезжает с другого. */
function wrap01(value: number): number {
    const r = value % 1;
    return r < 0 ? r + 1 : r;
}

/**
 * Слой осадков над ареной (#546, §7.7). Отдельный канвас поверх игрового: у него свой
 * rAF с полной очисткой кадра, поэтому dirty-rect оптимизация игрового канваса (частичная
 * перерисовка только задетых сегментов) не ломается — прямой ответ на риск «постоянная
 * нагрузка на FPS» из разбора. Рендер и состояние разделены (`.claude/rules/canvas.md`):
 * выбор пресета и раскладка частиц — чистые функции `precipitation.ts`, здесь только
 * анимация и рисование.
 *
 * При `prefers-reduced-motion` частиц нет вовсе (правило 3 разбора): движения на арене,
 * где игрок ведёт палец, быть не должно. Погоду в этом режиме несёт тонировка рельефа
 * (её кладёт `GamePlay`/`Ground`) и — для бури — статичная дымка, которую рисует этот
 * слой один раз.
 */
export class Precipitation {
    readonly preset: TPrecipPreset;
    private readonly reducedMotion: boolean;
    /** Ветер, нормированный в [-1, 1]: знак — сторона сноса, модуль — сила. */
    private readonly windNorm: number;
    private readonly seed: number | string;
    private field: TPrecipParticle[];
    /** Накопленное время сцены, мс. Позиция частицы = старт + скорость × elapsed. */
    private elapsed = 0;
    /** Гашение на прицеливании: при активной оттяжке (`gestureVisual !== null`) — true. */
    private dimmed = false;
    private width = 0;
    private height = 0;

    constructor(options: TPrecipitationOptions) {
        this.preset = options.preset
            ? pickPrecipPresetById(options.preset)
            : pickPrecipPreset(options.seed);
        this.reducedMotion = options.reducedMotion;
        this.windNorm = precipWindNorm(options.wind ?? 0);
        this.seed = options.seed;
        this.field = buildPrecipField(this.seed, 0, this.preset);
    }

    /** Поле частиц — для тестов детерминизма и плотности. */
    precipField(): readonly TPrecipParticle[] {
        return this.field;
    }

    /** Накопленное время сцены, мс — для тестов движения. */
    elapsedMs(): number {
        return this.elapsed;
    }

    /** Гашение на прицеливании: `gestureVisual !== null` (тот же сигнал, что у #527). */
    setDimmed(dimmed: boolean): void {
        this.dimmed = dimmed;
    }

    /**
     * Двигает время сцены. При `prefers-reduced-motion` — no-op: частиц нет, двигать
     * нечего. Копится ОДНО время, а не позиция каждой частицы: позиция считается в draw
     * как `старт + скорость × elapsed` — дрейфа между частицами не накапливается.
     */
    update(dt: number): void {
        if (this.reducedMotion || dt <= 0) return;
        this.elapsed += dt;
    }

    resize(width: number, height: number): void {
        const nextWidth = Math.max(0, Math.floor(width));
        // Плотность зависит от ширины (`precipCount`) — поле пересобирается при её
        // изменении. Смена только высоты поле не трогает (поворот телефона не должен
        // переставлять осадки).
        if (nextWidth !== this.width) {
            this.field = buildPrecipField(this.seed, nextWidth, this.preset);
        }
        this.width = nextWidth;
        this.height = Math.max(0, Math.floor(height));
    }

    draw(ctx: CanvasRenderingContext2D): void {
        const width = this.width || ctx.canvas?.width || 0;
        const height = this.height || ctx.canvas?.height || 0;
        if (width <= 0 || height <= 0) return;
        ctx.clearRect(0, 0, width, height);
        if (this.reducedMotion) {
            this.paintReducedMotion(ctx, width, height);
            return;
        }
        if (!this.preset.shape) return;
        this.paintParticles(ctx, width, height);
    }

    /**
     * Статика для `prefers-reduced-motion`: частиц нет (тонировку рельефа кладёт
     * `Ground`), но у бури — дымка 6% поверх всего кадра, читается как взвесь пыли.
     */
    private paintReducedMotion(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const haze = this.preset.reducedMotionHaze;
        if (!haze) return;
        ctx.save();
        ctx.globalAlpha = haze.alpha;
        ctx.fillStyle = haze.color;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    /**
     * Рисует частицы: позиция = старт + падение×elapsed по вертикали и снос ветром по
     * горизонтали, обе координаты заворачиваются в кадр. Частицы квантованы в пиксельную
     * сетку устройства (`snap`) — иначе канвас каждый кадр пересэмплирует их и сетка
     * «кипит» (тот же приём, что у облаков в `sky-scene.ts`). Альфа домножается на
     * `precipAlphaScale`: при активной оттяжке всё поле гаснет (правило 2 разбора).
     */
    private paintParticles(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const dpr = getDevicePixelRatio();
        const alphaScale = precipAlphaScale(this.dimmed);
        ctx.save();
        ctx.fillStyle = this.preset.color;
        for (const p of this.field) {
            const fall = this.preset.fallSpeed * p.speed * this.elapsed;
            const drift = this.preset.driftSpeed * this.windNorm * p.speed * this.elapsed;
            const x = snapToDevicePixel(wrap01(p.xFrac + drift) * width, dpr);
            const y = snapToDevicePixel(wrap01(p.yFrac + fall) * height, dpr);
            ctx.globalAlpha = p.alpha * alphaScale;
            this.paintShape(ctx, x, y, p);
        }
        ctx.restore();
    }

    /** Одна частица нужной формы: 1×3 линия (дождь), 2×2 квадрат (снег), 1×N штрих (буря). */
    private paintShape(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        p: TPrecipParticle,
    ): void {
        switch (this.preset.shape) {
            case 'line': {
                // Дождь: 1×3 px линия, слегка наклонённая по ветру.
                const len = Math.max(2, Math.round(3 * p.scale * p.length));
                const slant = this.windNorm * 0.6;
                ctx.fillRect(x + Math.round(slant * len), y, 1, len);
                break;
            }
            case 'square': {
                // Снег: 2×2 px квадрат.
                const size = Math.max(1, Math.round(2 * p.scale));
                ctx.fillRect(x, y, size, size);
                break;
            }
            case 'streak': {
                // Буря: горизонтальный штрих высотой 1 px, летящий по ветру.
                const len = Math.max(2, Math.round(3 * p.scale * p.length));
                const dir = this.windNorm < 0 ? -1 : 1;
                ctx.fillRect(dir < 0 ? x - len : x, y, len, 1);
                break;
            }
            default:
                break;
        }
    }
}
