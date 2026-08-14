import { getDevicePixelRatio, snapToDevicePixel } from '@/shared/lib/canvas';
import { pickPrecipPresetById, precipWindNorm } from './precipitation';
import { edgeHighlightColor } from './scene-light';
import { pickSkyPresetById } from './sky-preset';
import { buildWindDustField, WIND_DUST_BAND_MIN, type TWindDustParticle } from './wind-dust';

type TWindDustOptions = {
    seed: number | string;
    /** Ветер боя (`GamePlay.wind`): пылинки летят по нему, знак — сторона сноса. */
    wind: number;
    /** Пресет неба `night` (#519/#545, тот же сид, что у `SkyBackground`). */
    isNight: boolean;
    reducedMotion: boolean;
};

/** Заворачивает долю в [0, 1) — частица, уехавшая за край кадра, въезжает с другого. */
function wrap01(value: number): number {
    const r = value % 1;
    return r < 0 ? r + 1 : r;
}

/** Снос по ширине канваса в мс при ветре в полную силу — заметно медленнее осадков. */
const DRIFT_SPEED = 0.00022;

/** Тон пылинки — цвет частиц бури (`precipitation.ts`), песок в воздухе. */
const DUST_COLOR = pickPrecipPresetById('sandstorm').color;

/**
 * Тон ночной подсветки кромки — тот же цвет, что и ambient-кайма светила ночью
 * (`Ground.highlightCrest`, #545): визуально одна и та же «подсветка кромки песка»,
 * только её альфа здесь растёт с силой ветра, а не постоянна.
 */
const NIGHT_EDGE_COLOR = edgeHighlightColor(pickSkyPresetById('night'));

/**
 * Ветровые пылинки приземного слоя (#550): отдельный канвас-слой, тот же паттерн, что
 * `Precipitation` — рендер отделён от раскладки (`.claude/rules/canvas.md`), свой rAF,
 * не задевает dirty-rect игрового канваса. Ночью частицы плохо читаются на тёмном
 * фоне — вместо них тонкая подсветка у кромки песка, её альфа растёт с силой ветра
 * (тот же носитель, другая техника подачи, по решению разбора #534 §7).
 */
export class WindDust {
    private readonly field: TWindDustParticle[];
    private driftNorm: number;
    private readonly isNight: boolean;
    private readonly reducedMotion: boolean;
    /** Накопленное время сцены, мс. Позиция частицы = старт + скорость × elapsed. */
    private elapsed = 0;
    private width = 0;
    private height = 0;

    constructor(options: TWindDustOptions) {
        this.field = buildWindDustField(options.seed, options.wind);
        this.driftNorm = precipWindNorm(options.wind);
        this.isNight = options.isNight;
        this.reducedMotion = options.reducedMotion;
    }

    /** Поле частиц — для тестов детерминизма/плотности. */
    dustField(): readonly TWindDustParticle[] {
        return this.field;
    }

    /**
     * Есть ли что анимировать. Ночью слой рисует статичную кайму, в штиль — ничего,
     * при `reduced-motion` — тоже ничего: во всех трёх случаях rAF крутил бы пустой
     * `clearRect` 60 раз в секунду весь бой (правило `.claude/rules/canvas.md` —
     * «статичные слои перерисовываются только при изменении»).
     */
    get animated(): boolean {
        return this.field.length > 0 && !this.isNight && !this.reducedMotion;
    }

    /** Новый ветер боя без пересборки поля пылинок (#547) — см. `PrecipitationScene.setWind`. */
    setWind(wind: number): void {
        this.driftNorm = precipWindNorm(wind);
    }

    update(dt: number): void {
        if (this.reducedMotion || dt <= 0) return;
        this.elapsed += dt;
    }

    resize(width: number, height: number): void {
        this.width = Math.max(0, Math.floor(width));
        this.height = Math.max(0, Math.floor(height));
    }

    draw(ctx: CanvasRenderingContext2D): void {
        const width = this.width || ctx.canvas?.width || 0;
        const height = this.height || ctx.canvas?.height || 0;
        if (width <= 0 || height <= 0) return;
        ctx.clearRect(0, 0, width, height);
        // Штиль — носителей нет вовсе (критерий #550), ни пылинок, ни ночной подсветки.
        if (this.field.length === 0) return;
        if (this.isNight) {
            this.paintEdgeGlow(ctx, width, height);
            return;
        }
        // reduced-motion: движения на арене, где ведут палец, быть не должно (правило
        // 3 разбора #546/#547, тот же приём) — пылинки не рисуем вовсе.
        if (this.reducedMotion) return;
        this.paintDust(ctx, width, height);
    }

    private paintDust(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const dpr = getDevicePixelRatio();
        ctx.save();
        ctx.fillStyle = DUST_COLOR;
        for (const p of this.field) {
            const drift = DRIFT_SPEED * this.driftNorm * p.speed * this.elapsed;
            const x = snapToDevicePixel(wrap01(p.xFrac + drift) * width, dpr);
            const y = snapToDevicePixel(p.yFrac * height, dpr);
            ctx.globalAlpha = p.alpha;
            ctx.fillRect(x, y, 1, 1);
        }
        ctx.restore();
    }

    private paintEdgeGlow(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        // Тот же dpr-снап, что у пылинок этого же класса: на дробном dpr `Math.round`
        // по логическим пикселям оставляет кайму на полупикселе, и линия размывается.
        const y = snapToDevicePixel(height * WIND_DUST_BAND_MIN, getDevicePixelRatio());
        ctx.save();
        ctx.globalAlpha = Math.min(0.5, 0.15 + 0.35 * Math.abs(this.driftNorm));
        ctx.fillStyle = NIGHT_EDGE_COLOR;
        ctx.fillRect(0, y, width, 1);
        ctx.restore();
    }
}
