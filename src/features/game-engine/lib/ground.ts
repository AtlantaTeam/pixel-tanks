import { floor, getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import type { TSeededRandom } from '@/shared/lib/random';
import { computeTerrainHeights, EMPTY_ARENA_INSETS, type TArenaInsets } from './arena-insets';
import { withAlpha } from './sky-celestial';
import type { TGroundTintLayer } from './scene-light';

type TExplosion = {
    bulletY: number;
    delta: number;
};

/**
 * Осадки-дождь (#547, §7.8): столбцы воронок затемняются — размокший песок темнее
 * сухого. `darkenAlpha` — сила затемнения, `edgeSoftenPx` — на сколько пикселей по
 * краям воронки альфа спадает («оплывший» край, не резкий обрыв). Пусто (нет дождя)
 * — воронки как обычно.
 */
export type TCraterStyle = {
    darkenAlpha: number;
    edgeSoftenPx: number;
};

/** Тёмный тон размокшей воронки (#547): почти чёрный, силу задаёт `darkenAlpha`. */
const CRATER_DARKEN_COLOR = '#0a0806';

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
    /**
     * Тонировка земли по времени суток (#545, §6): плоские слои цвета поверх силуэта
     * рельефа (`source-atop`), «включатель» пресета. Пусто (день) → рельеф без тона,
     * как было до светила. Запекается в offscreen-слой вместе с песком — не проход за
     * кадр.
     */
    private tint: readonly TGroundTintLayer[];
    /**
     * Тон каймы светила (#545, §6): 1 px подсветка верхней кромки песка — ридж ловит
     * свет. `undefined` (день/до светила) → кромку не подсвечиваем.
     */
    private edgeColor: string | undefined;
    /**
     * Стиль затемнения воронок дождём (#547). `undefined` (нет дождя) — воронки не
     * темнеют. Запекается в offscreen-слой вместе с рельефом — не проход за кадр.
     */
    private craterStyle: TCraterStyle | undefined;
    /**
     * Столбцы, задетые воронкой (#547): `fall` помечает их, `darkenCraters` темнит.
     * Постоянна на весь бой — воронка остаётся тёмной после осыпания. Индекс = X.
     */
    private cratered: boolean[];
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
        tint: readonly TGroundTintLayer[] = [],
        edgeColor?: string,
        craterStyle?: TCraterStyle,
    ) {
        this.random = random;
        this.tint = tint;
        this.edgeColor = edgeColor;
        this.craterStyle = craterStyle;
        this.stepMax = 3;
        this.stepChange = 0.3;
        this.innerWidth = innerWidth;
        this.innerHeight = innerHeight;
        this.insets = insets;
        // Границы рельефа — из свободной зоны, а не из полной высоты канваса
        // (safe-зона, #454). Пустые инсеты дают ровно прежние floor(H/2), floor(H/2)/4.
        // Ширина нужна для клиренса ствола: он масштабируется вместе с телом (#455).
        const { min, max } = computeTerrainHeights(innerHeight, insets, innerWidth);
        this.heightMax = max;
        this.heightMin = min;
        this.color = 'orange';
        this.sandImage = sandImage;
        this.sandImagePattern = null;
        this.heights = [];
        this.explosionHeights = [];
        this.cratered = [];
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
            this.cratered[x] = false;
        }
    };

    /**
     * Плоская полоса высот — рельеф демо-кадров витрины и тестов, где дюны только
     * мешают (демо флажка ветра: наклон корпуса не должен спорить с наклоном
     * полотнища).
     *
     * Метод, а не присваивание `ground.heights` снаружи (ревью #579): прямая мутация
     * публичного поля идёт МИМО инвалидации offscreen-слоя, и проносило это только
     * потому, что у свежесозданного `Ground` слой и так грязный. Появись путь, где
     * сцена перестраивается на уже отрисованном рельефе, — витрина показала бы
     * закешированный старый профиль. Заодно сбрасываются воронки: плоский рельеф
     * с чужими кратерами — не плоский рельеф.
     */
    flatten = (height: number) => {
        this.heights = new Array<number>(this.innerWidth).fill(floor(height));
        this.explosionHeights = new Array<number | TExplosion>(this.innerWidth).fill(0);
        this.cratered = new Array<boolean>(this.innerWidth).fill(false);
        this.layerDirty = true;
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
        const next = computeTerrainHeights(innerHeight, this.insets, innerWidth);
        this.heightMax = next.max;
        this.heightMin = next.min;
        this.heights = new Array<number>(innerWidth);
        this.explosionHeights = new Array<number>(innerWidth).fill(0);
        // Метки воронок (#547) переносим в новую ширину ближайшим столбцом — чтобы
        // затемнение осталось на кратерах после ресайза. Ресайза в реплее нет
        // (размер зафиксирован записью), так что на детерминизм это не влияет.
        const oldCratered = this.cratered;
        this.cratered = new Array<boolean>(innerWidth).fill(false);
        const step = innerWidth > 1 ? (oldWidth - 1) / (innerWidth - 1) : 0;
        for (let x = 0; x < innerWidth; x++) {
            const t = x * step;
            const x0 = Math.floor(t);
            const x1 = Math.min(x0 + 1, oldWidth - 1);
            const frac = t - x0;
            const interp = oldHeights[x0] * (1 - frac) + oldHeights[x1] * frac;
            this.heights[x] = floor(remapToBand(interp, prev, next));
            this.cratered[x] = oldCratered[Math.round(t)] ?? false;
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
        // Помечаем задетые воронкой столбцы (#547) — дождь затемнит их в offscreen-слое.
        for (let cx = x - radius; cx <= x + radius; cx++) {
            if (cx >= 0 && cx < this.innerWidth) this.cratered[cx] = true;
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
        this.applyTint(ctx);
        this.darkenCraters(ctx);
        this.highlightCrest(ctx);
        this.layerDirty = false;
    }

    /**
     * Затемняет столбцы воронок (#547, дождь): тёмный тон поверх силуэта рельефа
     * через `source-atop` (краска только на песок), по столбцу на воронку. Край
     * воронки «оплывает» — на `edgeSoftenPx` пикселей по краям альфа спадает
     * (`craterEdgeFactor`), а не обрывается резко. Нет дождя (`craterStyle` пуст)
     * или воронок ещё не было — no-op. Запекается в offscreen-слой, не проход за кадр.
     */
    private darkenCraters(ctx: CanvasRenderingContext2D) {
        const style = this.craterStyle;
        if (!style || style.darkenAlpha <= 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = CRATER_DARKEN_COLOR;
        const bandTop = this.innerHeight - this.heightMax;
        for (let x = 0; x < this.innerWidth; x++) {
            if (!this.cratered[x]) continue;
            ctx.globalAlpha = style.darkenAlpha * this.craterEdgeFactor(x, style.edgeSoftenPx);
            ctx.fillRect(x, bandTop, 1, this.heightMax);
        }
        ctx.restore();
    }

    /**
     * Коэффициент затемнения столбца воронки по близости к её краю (#547): 1 внутри,
     * меньше — у края. `edgeSoftenPx=1` даёт крайнему столбцу воронки 0.5 — край на
     * 1 px мягче. `0` — жёсткий край (коэффициент всегда 1).
     */
    private craterEdgeFactor(x: number, softenPx: number): number {
        if (softenPx <= 0) return 1;
        let dist = softenPx + 1;
        for (let d = 1; d <= softenPx; d++) {
            const leftClear = x - d < 0 || !this.cratered[x - d];
            const rightClear = x + d >= this.innerWidth || !this.cratered[x + d];
            if (leftClear || rightClear) {
                dist = d;
                break;
            }
        }
        return Math.min(1, dist / (softenPx + 1));
    }

    /**
     * Тонировка земли по пресету (#545, §6): каждый слой заливается поверх силуэта
     * рельефа через `source-atop` — краска ложится только на песок, не на небо между
     * склонами. Пустой список (день) — no-op, поведение до светила. Полоса берётся
     * по `heightMax` над горизонтом, как у `decorateWithSand`, чтобы тон покрыл всю
     * возможную высоту рельефа.
     */
    private applyTint(ctx: CanvasRenderingContext2D) {
        if (this.tint.length === 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        for (const layer of this.tint) {
            ctx.globalAlpha = layer.alpha;
            ctx.fillStyle = layer.color;
            ctx.fillRect(0, this.innerHeight - this.heightMax, this.innerWidth, this.heightMax);
        }
        ctx.restore();
    }

    /**
     * Подсветка кромки песка (#545, §6): 1 px линия по верху рельефа тоном каймы
     * светила — ридж ловит свет. Полупрозрачная, поверх тонировки (`source-over`),
     * чтобы читалась как блик, а не перекрашивала кромку целиком. День/до светила
     * (`edgeColor` не задан) — не рисуем.
     */
    private highlightCrest(ctx: CanvasRenderingContext2D) {
        if (!this.edgeColor) return;
        ctx.save();
        ctx.beginPath();
        // +0.5 — в центр пиксельной сетки, иначе 1 px линия размывается на два.
        ctx.moveTo(0, this.innerHeight - this.heights[0] + 0.5);
        for (let x = 1; x < this.innerWidth; x++) {
            ctx.lineTo(x, this.innerHeight - this.heights[x] + 0.5);
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = withAlpha(this.edgeColor, 0.55);
        ctx.stroke();
        ctx.restore();
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
            // Прямой `repeat` без зеркал: текстура (1024×1024) СДЕЛАНА бесшовной на этапе
            // ассета — перекрёстным затуханием с собственной копией, сдвинутой по кругу на
            // половину стороны (метод и замеры — `docs/game-visuals/design-briefs.md`).
            //
            // Зеркальный тайл, который стоял здесь раньше, шов прятал, но платил
            // симметрией: отражённые дюны читаются «бабочкой», и на большом экране это
            // заметнее исходного стыка. Правильное место лечения — картинка, а не рантайм.
            this.sandImagePattern = ctx.createPattern(this.sandImage, 'repeat');
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
