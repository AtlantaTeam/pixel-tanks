import { getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import { buildCloudField, cloudSpriteWidth, windFactor, type TCloudInstance } from './cloud-field';
import { wrapOffset } from './sky-parallax';
import { pickSkyPreset, pickSkyPresetById, type TSkyPreset, type TSkyPresetId } from './sky-preset';

/**
 * Ключи арта неба (файлы в `public/art/`). Облака — ОТДЕЛЬНЫЕ спрайты (`cloud-1..3`),
 * а не бесшовные ленты: так снят одобренный кадр `live-desktop.png` (#514).
 */
export type TSkyImages = {
    mountains?: HTMLImageElement;
    cloud1?: HTMLImageElement;
    cloud2?: HTMLImageElement;
    cloud3?: HTMLImageElement;
};

type TSkySceneOptions = {
    seed: number | string;
    reducedMotion: boolean;
    /**
     * Ветер боя (px/тик², как `GamePlay.wind`). Знак несёт направление облаков, модуль —
     * скорость (#518). Постоянен весь бой, поэтому меняется не в полёте, а от боя к бою.
     */
    wind?: number;
    /** Явный пресет — для витрины. Иначе выбирается по сиду. */
    preset?: TSkyPresetId;
    images?: TSkyImages;
    /** Фабрика offscreen-канваса (DI для тестов; в браузере — `document.createElement`). */
    createCanvas?: () => HTMLCanvasElement;
};

const defaultCreateCanvas = (): HTMLCanvasElement => document.createElement('canvas');

/**
 * Сцена неба под рельефом: статичный слой (градиент неба + силуэт гор) + параллакс
 * облачных слоёв. Рендер и состояние разделены (`.claude/rules/canvas.md`):
 * математика смещений — чистые функции `sky-parallax`, выбор пресета — `sky-preset`,
 * здесь только оркестрация рисования.
 *
 * Статичный слой перестраивается ТОЛЬКО при ресайзе (кешируется в offscreen), между
 * кадрами двигаются лишь смещения облаков — кадр не проседает (критерий #479).
 */
export class SkyScene {
    readonly preset: TSkyPreset;
    private readonly reducedMotion: boolean;
    private readonly images: TSkyImages;
    private readonly createCanvas: () => HTMLCanvasElement;
    private readonly seed: number | string;
    /** Множитель скорости и направления от ветра боя (#518). */
    private readonly wind: number;
    private field: TCloudInstance[];
    /** Накопленное время сцены, мс. Позиция облака = старт + скорость × elapsed. */
    private elapsed = 0;

    private width = 0;
    private height = 0;
    private staticDirty = true;
    /** Offscreen недоступен (нет 2D-контекста, напр. happy-dom): запомнить и не пересоздавать канвас каждый кадр. */
    private offscreenUnavailable = false;

    private staticCanvas: HTMLCanvasElement | null = null;
    private mountainCanvas: HTMLCanvasElement | null = null;

    constructor(options: TSkySceneOptions) {
        this.preset = options.preset
            ? pickSkyPresetById(options.preset)
            : pickSkyPreset(options.seed);
        this.reducedMotion = options.reducedMotion;
        this.images = options.images ?? {};
        this.createCanvas = options.createCanvas ?? defaultCreateCanvas;
        this.seed = options.seed;
        this.wind = windFactor(options.wind ?? 0);
        // Ширина ещё неизвестна (resize придёт следом) — поле строится под дефолт и
        // пересобирается в resize, когда ширина изменилась.
        this.field = buildCloudField(this.seed, 0);
    }

    /** Поле облаков — для тестов детерминизма и плотности. */
    cloudField(): readonly TCloudInstance[] {
        return this.field;
    }

    /** Накопленное время сцены, мс — для тестов движения. */
    elapsedMs(): number {
        return this.elapsed;
    }

    isStaticDirty(): boolean {
        return this.staticDirty;
    }

    /**
     * Помечает статичный слой (градиент + силуэт гор) на перестройку. Нужен, когда
     * спрайт гор догрузился ПОСЛЕ первого кадра: горы запекаются в offscreen-кеш
     * внутри `ensureStatic`, а он иначе перестраивается только при `resize()` — без
     * этой инвалидации силуэт гор не попал бы в кеш и не появился до первого ресайза.
     */
    markStaticDirty(): void {
        this.staticDirty = true;
    }

    /**
     * Двигает время сцены. При `prefers-reduced-motion` — no-op: облака замирают,
     * градиент и горы остаются (критерий #479). НЕ трогает статичный слой: между
     * кадрами перерисовки фона нет.
     *
     * Копится ОДНО время, а не смещение каждого облака: позиция считается в draw как
     * `старт + скорость × elapsed`, поэтому дрейфа между облаками не накапливается,
     * а каждое по-прежнему едет со своей скоростью.
     */
    update(dt: number): void {
        if (this.reducedMotion || dt <= 0) return;
        this.elapsed += dt;
    }

    resize(width: number, height: number): void {
        const nextWidth = Math.max(0, Math.floor(width));
        // Плотность облаков зависит от ширины (`cloudCount`), поэтому поле
        // пересобирается при её изменении. Смена только высоты поле не трогает:
        // поворот телефона не должен переставлять облака.
        if (nextWidth !== this.width) {
            this.field = buildCloudField(this.seed, nextWidth);
        }
        this.width = nextWidth;
        this.height = Math.max(0, Math.floor(height));
        this.staticDirty = true;
    }

    draw(ctx: CanvasRenderingContext2D): void {
        const width = this.width || ctx.canvas?.width || 0;
        const height = this.height || ctx.canvas?.height || 0;
        if (width <= 0 || height <= 0) return;

        const staticLayer = this.ensureStatic(width, height);
        if (staticLayer) {
            ctx.drawImage(staticLayer, 0, 0, width, height);
        } else {
            // Окружение без offscreen (тесты/SSR): рисуем фон прямо в целевой ctx.
            this.paintStatic(ctx, width, height);
        }
        this.drawClouds(ctx, width, height);
    }

    /** Строит (или переиспользует) offscreen со статичным фоном. null — если offscreen недоступен. */
    private ensureStatic(width: number, height: number): HTMLCanvasElement | null {
        // Offscreen уже признан недоступным — не аллоцируем канвас в кадре (canvas.md).
        if (this.offscreenUnavailable) return null;
        if (!this.staticDirty && this.staticCanvas) return this.staticCanvas;

        const dpr = getDevicePixelRatio();
        const canvas = this.staticCanvas ?? this.createCanvas();
        canvas.width = toDevicePixels(width, dpr);
        canvas.height = toDevicePixels(height, dpr);
        const offscreenCtx = canvas.getContext('2d');
        if (!offscreenCtx) {
            // Нет 2D-контекста (happy-dom) — фон рисуется напрямую, без кеша.
            // Запоминаем недоступность, чтобы не пересоздавать канвас каждый draw.
            this.staticCanvas = null;
            this.staticDirty = false;
            this.offscreenUnavailable = true;
            return null;
        }
        offscreenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        offscreenCtx.clearRect(0, 0, width, height);
        this.paintStatic(offscreenCtx, width, height);
        this.staticCanvas = canvas;
        this.staticDirty = false;
        return canvas;
    }

    /** Красит градиент неба + силуэт гор в переданный ctx (в CSS-пикселях). */
    private paintStatic(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        for (const stop of this.preset.sky) {
            gradient.addColorStop(stop.offset, stop.color);
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        this.paintMountains(ctx, width, height);
    }

    private paintMountains(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const image = this.images.mountains;
        if (!image || !image.width || !image.height) return;
        const tinted = this.ensureTintedMountain(image);
        const source = tinted ?? image;
        // Силуэт дальних гор во всю ширину, низом у горизонта (~62% высоты неба).
        // Высота — доля высоты неба (арт 1024×130 ≈ 8:1, растяжение по вертикали
        // читается как атмосферная дымка, гор в бою всё равно касаются взглядом мельком).
        const bandHeight = Math.round(height * 0.16);
        const bottom = Math.round(height * 0.62);
        ctx.drawImage(source, 0, bottom - bandHeight, width, bandHeight);
    }

    /**
     * Перекрашивает силуэт гор в тон пресета через `source-in` (сохраняет альфу
     * исходного PNG). Кешируется — тон зависит только от пресета, не меняется
     * между кадрами/ресайзами. null — если offscreen недоступен (тогда рисуем
     * исходный PNG как есть).
     */
    private ensureTintedMountain(image: HTMLImageElement): HTMLCanvasElement | null {
        if (this.mountainCanvas) return this.mountainCanvas;
        const canvas = this.createCanvas();
        canvas.width = image.width;
        canvas.height = image.height;
        const tintCtx = canvas.getContext('2d');
        if (!tintCtx) return null;
        tintCtx.drawImage(image, 0, 0);
        tintCtx.globalCompositeOperation = 'source-in';
        tintCtx.fillStyle = this.preset.mountain;
        tintCtx.fillRect(0, 0, image.width, image.height);
        this.mountainCanvas = canvas;
        return canvas;
    }

    /**
     * Рисует поле ОТДЕЛЬНЫХ облаков: каждое со своим спрайтом, высотой и скоростью
     * (`cloud-field.ts`). Раньше здесь повторялась бесшовная лента — небо выходило
     * плотным, а движение читалось рывком целого слоя (#514).
     *
     * Движение идёт РОВНЫМ КАДАНСОМ: облако сдвигается ровно на один пиксель устройства
     * через равный интервал времени (`elapsed / msPerDevicePixel`), а не «куда попало,
     * потом округлим».
     *
     * Почему так, а не round(позиции): дробная позиция заставляет канвас каждый кадр
     * пересэмплировать спрайт заново — пиксельная сетка кипит. Но и округление самой
     * позиции не годится: dt между кадрами гуляет, границы пикселя пересекаются
     * неравномерно, и шаги сбиваются в «шаг-шаг-пауза» — на глаз это тормоз-газ (#515).
     * Деление времени на равные интервалы убирает и то, и другое.
     */
    private drawClouds(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        ctx.save();
        ctx.globalAlpha = this.preset.cloudAlpha;
        const dpr = getDevicePixelRatio();
        const devicePixel = 1 / dpr;
        const snap = (value: number) => Math.round(value * dpr) / dpr;
        for (const cloud of this.field) {
            const image = this.images[cloud.sprite];
            if (!image || !image.width || !image.height) continue;
            // Размер — доля ширины экрана (`cloudSpriteWidth`), а не фиксированные
            // CSS-пиксели: 192 px совпадали с десктопным эталоном, но на 390 занимали
            // половину ширины (#523). К dpr привязывать тоже нельзя — на экране без
            // ретины облако выходило вдвое крупнее макета (#514).
            const spriteWidth = cloudSpriteWidth(width);
            const spriteHeight = Math.max(
                1,
                Math.round((image.height * spriteWidth) / image.width),
            );
            // Поле шире экрана на спрайт: облако уезжает за край и въезжает с другого,
            // не исчезая на глазах.
            const span = width + spriteWidth;
            // Сколько миллисекунд на один пиксель устройства при этой скорости.
            // Ветер меняет темп (модуль) и сторону (знак) — каданс от этого не ломается:
            // шаг по-прежнему целый пиксель через равный интервал.
            const msPerDevicePixel = devicePixel / (cloud.speed * Math.abs(this.wind));
            const steps = Math.floor(this.elapsed / msPerDevicePixel);
            const direction = this.wind < 0 ? -1 : 1;
            const travelled = snap(cloud.xFrac * span) + direction * steps * devicePixel;
            const x = wrapOffset(travelled, span) - spriteWidth;
            ctx.drawImage(image, x, snap(height * cloud.yFrac), spriteWidth, spriteHeight);
        }
        ctx.restore();
    }
}
