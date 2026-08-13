import { getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import {
    advanceOffset,
    CLOUD_OFFSET_PERIOD,
    createInitialOffsets,
    wrapOffset,
} from './sky-parallax';
import { pickSkyPreset, pickSkyPresetById, type TSkyPreset, type TSkyPresetId } from './sky-preset';

/** Ключи арта неба (файлы в `public/art/`). */
export type TSkyImages = {
    mountains?: HTMLImageElement;
    far?: HTMLImageElement;
    near?: HTMLImageElement;
};

type TCloudImageKey = 'far' | 'near';

type TCloudLayerSpec = {
    image: TCloudImageKey;
    /** Скорость параллакса, px/мс. Дальний слой медленнее ближнего — так рождается глубина. */
    speed: number;
    /** Верх слоя как доля высоты канваса (0 — верх экрана). */
    topFrac: number;
};

/**
 * Конфиг облачных слоёв: дальний (медленный) и ближний (быстрый). Разные скорости —
 * это и есть параллакс (PRD «2–3 слоя, разная скорость»). `topFrac` держит оба слоя
 * в верхней половине неба, над рельефом; РАЗМЕР слоя здесь не задаётся — см.
 * `cloudTileSize` (#510).
 */
export const CLOUD_LAYER_SPECS: readonly TCloudLayerSpec[] = [
    { image: 'far', speed: 0.006, topFrac: 0.07 },
    { image: 'near', speed: 0.017, topFrac: 0.18 },
];

/**
 * Доля ширины канваса, шире которой облачный тайл не растягивается. 1.15 — чуть шире
 * экрана: в кадр попадает почти вся полоса арта, то есть несколько облаков, а не одно
 * в увеличении. Нужен только там, где натуральный размер арта крупнее экрана: узкое
 * окно без ретины (dpr 1, ширина < ~890 px).
 */
const CLOUD_TILE_MAX_WIDTH_FRAC = 1.15;

/**
 * Размер облачного тайла в CSS-пикселях: **натуральный размер арта**, то есть один
 * пиксель арта на один пиксель устройства.
 *
 * Так был снят одобренный макет (`docs/game-visuals/iteration-2/mockup-day.png`): замер
 * дал 0.95 device-px на пиксель арта. Прежняя формула считала высоту слоя долей ВЫСОТЫ
 * канваса, а ширину выводила из неё, — на 390×844 полоса растягивалась до 2.3 ширин
 * экрана, и вместо десятка облачков было видно два в двойном увеличении (#510). Побочно
 * та формула давала дробный масштаб, от которого пиксельная сетка арта мылилась.
 *
 * Высота канваса в расчёт не входит намеренно: поворот телефона не должен менять размер
 * облаков при той же ширине.
 */
export function cloudTileSize(
    image: { width: number; height: number },
    canvasWidth: number,
    dpr: number,
): { tileWidth: number; tileHeight: number } {
    const natural = image.width / Math.max(dpr, 0.01);
    const tileWidth = Math.max(
        1,
        Math.round(Math.min(natural, canvasWidth * CLOUD_TILE_MAX_WIDTH_FRAC)),
    );
    // Высота — от итоговой ширины по пропорции арта: облака не сплющиваются, когда
    // сработал потолок.
    const tileHeight = Math.max(1, Math.round((image.height * tileWidth) / image.width));
    return { tileWidth, tileHeight };
}

type TCloudLayer = {
    spec: TCloudLayerSpec;
    /** Текущее накопленное смещение слоя, px. */
    offset: number;
};

type TSkySceneOptions = {
    seed: number | string;
    reducedMotion: boolean;
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
    private readonly layers: TCloudLayer[];

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
        const initial = createInitialOffsets(options.seed, CLOUD_LAYER_SPECS.length);
        this.layers = CLOUD_LAYER_SPECS.map((spec, i) => ({ spec, offset: initial[i] }));
    }

    /** Текущие смещения облачных слоёв — для тестов детерминизма/движения. */
    cloudOffsets(): number[] {
        return this.layers.map((layer) => layer.offset);
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
     * Двигает облачные слои по времени. При `prefers-reduced-motion` — no-op:
     * облака замирают, градиент и горы остаются (критерий #479). НЕ трогает
     * статичный слой: между кадрами перерисовки фона нет.
     */
    update(dt: number): void {
        if (this.reducedMotion || dt <= 0) return;
        for (const layer of this.layers) {
            // Период завёртки — та же константа, что и у стартового разброса
            // (`CLOUD_OFFSET_PERIOD`): условный, нужен лишь чтобы offset не рос бесконечно.
            layer.offset = advanceOffset(layer.offset, layer.spec.speed, dt, CLOUD_OFFSET_PERIOD);
        }
    }

    resize(width: number, height: number): void {
        this.width = Math.max(0, Math.floor(width));
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
     * Рисует облачные слои с бесшовным ГОРИЗОНТАЛЬНЫМ повтором. `wrapOffset` и
     * зеркалирование соседних тайлов держат стык только по X — вертикального
     * повтора/зеркалирования НЕТ: слой рассчитан на узкую верхнюю полосу неба
     * и кладётся в один тайл по высоте.
     *
     * Размер тайла — натуральный размер арта (`cloudTileSize`), от высоты канваса он
     * не зависит (#510).
     */
    private drawClouds(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        ctx.save();
        ctx.globalAlpha = this.preset.cloudAlpha;
        const dpr = getDevicePixelRatio();
        for (const layer of this.layers) {
            const image = this.images[layer.spec.image];
            if (!image || !image.width || !image.height) continue;
            const { tileWidth, tileHeight: layerHeight } = cloudTileSize(image, width, dpr);
            const top = Math.round(height * layer.spec.topFrac);
            // Смещение завёрнуто по ширине тайла, чтобы слой бесшовно повторялся.
            const shift = wrapOffset(layer.offset, tileWidth);
            // Зеркалим соседние тайлы: арт не идеально бесшовен по краям (см.
            // iteration-1 README), зеркальный повтор прячет стык — как в Ground.
            for (let x = -shift; x < width; x += tileWidth) {
                const tileIndex = Math.round((x + shift) / tileWidth);
                const mirrored = Math.abs(tileIndex) % 2 === 1;
                if (mirrored) {
                    ctx.save();
                    ctx.translate(x + tileWidth, top);
                    ctx.scale(-1, 1);
                    ctx.drawImage(image, 0, 0, tileWidth, layerHeight);
                    ctx.restore();
                } else {
                    ctx.drawImage(image, x, top, tileWidth, layerHeight);
                }
            }
        }
        ctx.restore();
    }
}
