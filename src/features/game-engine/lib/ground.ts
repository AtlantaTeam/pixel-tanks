import { floor, getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import type { TSeededRandom } from '@/shared/lib/random';
import { computeTerrainHeights, EMPTY_ARENA_INSETS, type TArenaInsets } from './arena-insets';

type TExplosion = {
    bulletY: number;
    delta: number;
};

type THeightBand = { min: number; max: number };

/**
 * Линейно переносит высоту рельефа из одной полосы в другую, сохраняя её
 * относительное положение внутри полосы (форму карты). Пустая старая полоса
 * (span 0) — вырожденный ровный рельеф: кладём всё в низ новой полосы.
 */
function remapToBand(value: number, prev: THeightBand, next: THeightBand): number {
    const prevSpan = prev.max - prev.min;
    const nextSpan = next.max - next.min;
    const rel = prevSpan > 0 ? (value - prev.min) / prevSpan : 0;
    return next.min + rel * nextSpan;
}

export class Ground {
    private stepMax: number;
    private stepChange: number;
    private heightMax: number;
    private heightMin: number;
    private color: string;
    private sandImage: HTMLImageElement | undefined;
    private sandImagePattern: CanvasPattern | null;
    heights: number[];
    private explosionHeights: (number | TExplosion)[];
    private innerWidth: number;
    private innerHeight: number;
    /**
     * Инсеты оверлеев (HUD/палуба): рельеф генерируется и рескейлится внутри
     * свободной зоны арены (safe-зона, issue #454) — низ поднят на нижний инсет,
     * амплитуда от высоты зоны. Пустые инсеты = поведение до safe-зоны (весь канвас).
     */
    private insets: TArenaInsets;
    private random: TSeededRandom;
    isFalling = false;
    // Статичный террейн — offscreen-слой (.claude/rules/canvas.md: «статичные
    // слои — отдельный offscreen canvas, перерисовывать только при изменении»).
    // draw() при чистом слое просто блитит закешированный битмап, не перестраивая
    // path заново каждый кадр — критично для tankAreaRedraw во время оттяжки
    // прицела, который раньше гонял fullRedraw → Ground.draw на каждый кадр драга.
    private layerCanvas: HTMLCanvasElement | null = null;
    private layerCtx: CanvasRenderingContext2D | null = null;
    private layerDirty = true;

    constructor(
        innerWidth: number,
        innerHeight: number,
        random: TSeededRandom,
        sandImage?: HTMLImageElement,
        insets: TArenaInsets = EMPTY_ARENA_INSETS,
    ) {
        this.random = random;
        this.stepMax = 3;
        this.stepChange = 0.3;
        this.innerWidth = innerWidth;
        this.innerHeight = innerHeight;
        this.insets = insets;
        // Границы рельефа — из свободной зоны, а не из полной высоты канваса
        // (safe-зона, #454). Пустые инсеты дают ровно прежние floor(H/2), floor(H/2)/4.
        const { min, max } = computeTerrainHeights(innerHeight, insets);
        this.heightMax = max;
        this.heightMin = min;
        this.color = 'orange';
        this.sandImage = sandImage;
        this.sandImagePattern = null;
        this.heights = [];
        this.explosionHeights = [];
        this.generate();
    }

    generate = () => {
        let height = this.random() * this.heightMax;
        let slope = this.random() * this.stepMax * 2 - this.stepMax;

        for (let x = 0; x < this.innerWidth; x++) {
            const isTooHigh = this.heightMax / height < 1.1;
            const isTooLow = height / this.heightMin < 1.1;
            this.stepMax = isTooHigh || isTooLow ? 0.9 : 3;

            height += slope;
            slope += this.random() * this.stepChange * 2 - this.stepChange;

            slope = slope > this.stepMax ? this.stepMax : slope;
            slope = slope < -this.stepMax ? -this.stepMax : slope;

            if (height > this.heightMax) {
                height = this.heightMax;
                slope *= -1;
            }
            if (height < this.heightMin) {
                height = this.heightMin;
                slope *= -1;
            }
            this.heights[x] = floor(height);
            this.explosionHeights[x] = 0;
        }
    };

    // Пересчитывает рельеф под новый размер: интерполяция профиля по ширине и
    // перенос из старой полосы высот в новую по вертикали. В отличие от generate()
    // не трогает RNG — поворот экрана не меняет форму карты и не ломает детерминизм
    // seed'а; кратеры, уже вычтенные из heights, сохраняются в форме профиля.
    //
    // Полоса высот берётся из свободной зоны (safe-зона, #454): низ поднят на нижний
    // инсет, амплитуда от высоты зоны. Для пустых инсетов полоса пропорциональна
    // высоте канваса, поэтому перенос совпадает с прежним масштабом scaleY —
    // поведение до safe-зоны сохраняется.
    resize = (innerWidth: number, innerHeight: number) => {
        const oldHeights = this.heights;
        const oldWidth = oldHeights.length;
        const prev = { min: this.heightMin, max: this.heightMax };
        this.innerWidth = innerWidth;
        this.innerHeight = innerHeight;
        const next = computeTerrainHeights(innerHeight, this.insets);
        this.heightMax = next.max;
        this.heightMin = next.min;
        this.heights = new Array<number>(innerWidth);
        this.explosionHeights = new Array<number>(innerWidth).fill(0);
        const step = innerWidth > 1 ? (oldWidth - 1) / (innerWidth - 1) : 0;
        for (let x = 0; x < innerWidth; x++) {
            const t = x * step;
            const x0 = Math.floor(t);
            const x1 = Math.min(x0 + 1, oldWidth - 1);
            const frac = t - x0;
            const interp = oldHeights[x0] * (1 - frac) + oldHeights[x1] * frac;
            this.heights[x] = floor(remapToBand(interp, prev, next));
        }
        this.layerDirty = true;
    };

    /**
     * Перекладывает уже сгенерированный рельеф в свободную зону новых инсетов
     * (safe-зона, #454): линейный перенос профиля из текущей полосы высот в новую,
     * без RNG и без интерполяции по ширине (размер канваса не меняется — меняется
     * только высота оверлеев: брейкпоинт, safe-area). Идемпотентна: те же инсеты
     * дают ту же полосу и те же высоты. Танки движок переставляет сам по новым
     * `heights` (см. `GamePlay`).
     */
    applyInsets = (insets: TArenaInsets) => {
        const prev = { min: this.heightMin, max: this.heightMax };
        this.insets = insets;
        const next = computeTerrainHeights(this.innerHeight, insets);
        if (next.min === prev.min && next.max === prev.max) return;
        this.heightMax = next.max;
        this.heightMin = next.min;
        for (let x = 0; x < this.heights.length; x++) {
            this.heights[x] = floor(remapToBand(this.heights[x], prev, next));
        }
        this.layerDirty = true;
    };

    fall = (x: number, y: number, radius: number) => {
        this.explosionHeights[x - radius] = { bulletY: y, delta: 2 };
        this.explosionHeights[x + radius] = this.explosionHeights[x - radius];
        for (let i = 1; i <= radius; i++) {
            const katetNear = radius - i;
            const katetOpposite = floor(Math.sqrt(radius * radius - katetNear * katetNear));
            this.explosionHeights[x - radius + i] = { bulletY: y, delta: katetOpposite * 2 };
            this.explosionHeights[x + radius - i] = { bulletY: y, delta: katetOpposite * 2 };
        }
        this.layerDirty = true;
    };

    // Вызывать РОВНО РАЗ в начале animate()-тика движка. Пока кратер осыпается
    // (isFalling из прошлого кадра), помечает слой снова грязным — не более
    // одного re-render/шага мутации heights за кадр, сколько бы раз ни позвали
    // draw() в этом тике (взрыв и оба танка перерисовываются отдельными вызовами).
    beginFrame = () => {
        if (this.isFalling) this.layerDirty = true;
    };

    draw = (ctx: CanvasRenderingContext2D, xStart = 0, xEnd = this.innerWidth) => {
        if (this.layerDirty || !this.layerCanvas) {
            this.renderLayer();
        }
        this.blitLayer(ctx, xStart, xEnd);
    };

    private ensureLayerCtx(): CanvasRenderingContext2D | null {
        const dpr = getDevicePixelRatio();
        const width = toDevicePixels(this.innerWidth, dpr);
        const height = toDevicePixels(this.innerHeight, dpr);
        if (
            !this.layerCanvas ||
            this.layerCanvas.width !== width ||
            this.layerCanvas.height !== height
        ) {
            this.layerCanvas = document.createElement('canvas');
            this.layerCanvas.width = width;
            this.layerCanvas.height = height;
            this.layerCtx = this.layerCanvas.getContext('2d');
        }
        this.layerCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
        return this.layerCtx;
    }

    // Перестраивает path террейна и декор песка в offscreen-слой ЦЕЛИКОМ
    // (0..innerWidth), независимо от того, какой диапазон запросил draw().
    // Логика идентична прежнему draw(): смещение кратера (explosionHeights)
    // мутирует heights по ходу построения path — единственное место, где
    // рельеф физически меняется (осыпание кратера).
    private renderLayer() {
        const ctx = this.ensureLayerCtx();
        if (!ctx) return;
        this.isFalling = false;
        ctx.clearRect(0, 0, this.innerWidth, this.innerHeight);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.translate(0, this.innerHeight);
        ctx.beginPath();
        for (let x = 0; x < this.innerWidth; x += 1) {
            if (typeof this.explosionHeights[x] === 'object') {
                this.isFalling = true;
                const { bulletY, delta } = this.explosionHeights[x] as TExplosion;
                const bottomY = this.innerHeight - bulletY - delta / 2;
                if (delta) {
                    const h = -this.heights[x] + delta / 2;
                    ctx.moveTo(x, -this.heights[x]);
                    ctx.lineTo(x, h < 0 ? h : 0);
                    if (this.heights[x] > bottomY && bottomY > 0) {
                        this.heights[x] -= 1;
                    }
                    this.explosionHeights[x] = { bulletY, delta: delta - 1 };
                } else {
                    this.explosionHeights[x] = 0;
                }
                const h = -this.heights[x] + delta / 2;
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h < 0 ? h : 0);
            } else {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, -this.heights[x]);
            }
        }
        ctx.stroke();
        ctx.translate(0, -this.innerHeight);
        this.decorateWithSand(ctx, 0, this.innerWidth);
        this.layerDirty = false;
    }

    // Копирует срез закешированного слоя [xStart, xEnd] на целевой ctx. Источник —
    // в физических (device) пикселях слоя, назначение — в CSS-пикселях целевого
    // ctx (он уже масштабирован на dpr текущим transform, включая сдвиг shake).
    private blitLayer(ctx: CanvasRenderingContext2D, xStart: number, xEnd: number) {
        if (!this.layerCanvas) return;
        const clampedStart = Math.max(0, Math.min(xStart, this.innerWidth));
        const clampedEnd = Math.max(0, Math.min(xEnd, this.innerWidth));
        const width = clampedEnd - clampedStart;
        if (width <= 0) return;
        const dpr = getDevicePixelRatio();
        const srcX = Math.round(clampedStart * dpr);
        const srcWidth = Math.round(width * dpr);
        ctx.drawImage(
            this.layerCanvas,
            srcX,
            0,
            srcWidth,
            this.layerCanvas.height,
            clampedStart,
            0,
            width,
            this.innerHeight,
        );
    }

    private decorateWithSand(ctx: CanvasRenderingContext2D, xStart: number, xEnd: number) {
        if (!this.sandImage) return;
        if (!this.sandImagePattern) {
            // Текстура не бесшовная (1920px): на экранах шире стык тайла виден линией.
            // Зеркальный тайл 2× ширины делает повтор непрерывным. Аллокация одноразовая.
            const tile = document.createElement('canvas');
            tile.width = this.sandImage.width * 2;
            tile.height = this.sandImage.height;
            const tileCtx = tile.getContext('2d');
            if (tileCtx) {
                tileCtx.drawImage(this.sandImage, 0, 0);
                tileCtx.translate(tile.width, 0);
                tileCtx.scale(-1, 1);
                tileCtx.drawImage(this.sandImage, 0, 0);
                this.sandImagePattern = ctx.createPattern(tile, 'repeat');
            } else {
                this.sandImagePattern = ctx.createPattern(this.sandImage, 'repeat');
            }
        }
        ctx.save();
        if (ctx.globalCompositeOperation !== 'source-atop') {
            ctx.globalCompositeOperation = 'source-atop';
        }
        ctx.globalAlpha = 0.6;
        if (this.sandImagePattern) {
            ctx.fillStyle = this.sandImagePattern;
            ctx.rect(
                xStart - 1,
                this.innerHeight - this.heightMax,
                xEnd - xStart + 2,
                this.heightMax,
            );
            ctx.fill('evenodd');
        }
        ctx.restore();
    }
}
