import { getDevicePixelRatio, snapToDevicePixel, toDevicePixels } from '@/shared/lib/canvas';
import {
    buildStarField,
    pickCelestialGeometry,
    withAlpha,
    type TCelestialGeometry,
    type TStarInstance,
} from './sky-celestial';
import {
    buildCloudField,
    cloudSpriteWidth,
    MOUNTAIN_HORIZON_FRAC,
    windFactor,
    type TCloudInstance,
} from './cloud-field';
import { computeLightDirection, edgeHighlightColor } from './scene-light';
import { wrapOffset } from './sky-parallax';
import {
    pickSkyPreset,
    pickSkyPresetById,
    type TCelestialPreset,
    type TSkyPreset,
    type TSkyPresetId,
} from './sky-preset';

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
    private wind: number;
    private field: TCloudInstance[];
    /** Положение/размер солнца-луны — фиксируются сидом один раз, не зависят от ресайза. */
    private readonly celestial: TCelestialGeometry;
    /** Звёзды — только для ночного пресета; плотность зависит от ширины, как поле облаков. */
    private stars: TStarInstance[];
    /** Накопленное время сцены, мс. Позиция облака = старт + скорость × elapsed. */
    private elapsed = 0;

    private width = 0;
    private height = 0;
    private staticDirty = true;
    /** Offscreen недоступен (нет 2D-контекста, напр. happy-dom): запомнить и не пересоздавать канвас каждый кадр. */
    private offscreenUnavailable = false;

    private staticCanvas: HTMLCanvasElement | null = null;
    private mountainCanvas: HTMLCanvasElement | null = null;
    /** Силуэт гор, перекрашенный в тон каймы светила — для контура склона (#545). */
    private mountainEdgeCanvas: HTMLCanvasElement | null = null;

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
        this.celestial = pickCelestialGeometry(this.seed, this.preset.id);
        this.stars = this.preset.celestial.kind === 'moon' ? buildStarField(this.seed, 0) : [];
    }

    /** Поле облаков — для тестов детерминизма и плотности. */
    cloudField(): readonly TCloudInstance[] {
        return this.field;
    }

    /** Положение/размер светила — для тестов детерминизма и сектора неба. */
    celestialGeometry(): TCelestialGeometry {
        return this.celestial;
    }

    /** Звёздное поле — для тестов детерминизма и плотности (пусто вне ночного пресета). */
    starField(): readonly TStarInstance[] {
        return this.stars;
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
    /** Новый ветер боя без пересборки поля облаков (#547): иначе смена ветра бурей
     *  телепортировала бы облака в стартовые позиции сида посреди боя. */
    setWind(wind: number): void {
        this.wind = windFactor(wind);
    }

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
            if (this.preset.celestial.kind === 'moon') {
                this.stars = buildStarField(this.seed, nextWidth);
            }
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

    /** Красит градиент неба + светило + силуэт гор в переданный ctx (в CSS-пикселях). */
    private paintStatic(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        for (const stop of this.preset.sky) {
            gradient.addColorStop(stop.offset, stop.color);
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        // Светило/звёзды — ДО гор: у горизонта (закат) силуэт гор частично перекрывает
        // диск, как в жизни, а не рисуется поверх него.
        this.paintCelestial(ctx, width, height, gradient);
        this.paintMountains(ctx, width, height);
    }

    /**
     * Солнце/луна + звёзды (#519) — рисуются программно примитивами (дуги, клинья,
     * радиальные градиенты), без растра: при плавающем `world-scale` растровая
     * текстура мылится (уроки #496/#483). Часть статичного слоя — не перерисовывается
     * между кадрами (критерий #519 «кадр не проседает»).
     */
    private paintCelestial(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        skyGradient: CanvasGradient,
    ): void {
        const cel = this.preset.celestial;
        const cx = this.celestial.xFrac * width;
        const cy = this.celestial.yFrac * height;
        const radius = this.celestial.radiusFrac * Math.min(width, height);
        if (cel.kind === 'sun') {
            this.paintSun(ctx, cx, cy, radius, cel);
            return;
        }
        this.paintMoon(ctx, cx, cy, radius, cel, skyGradient);
        this.paintStars(ctx, width, height, cel);
    }

    /**
     * Солнце: мягкий ореол (радиальный градиент), лучи-спицы статичным углом (issue
     * просит начать без вращения — иначе слой перестал бы быть статичным) и диск
     * сверху. Закат — солнце крупнее и ниже (геометрия задаёт это), лучи длиннее и
     * мягче (ниже альфа), день — компактнее и ярче.
     */
    private paintSun(
        ctx: CanvasRenderingContext2D,
        cx: number,
        cy: number,
        radius: number,
        cel: TCelestialPreset,
    ): void {
        const isSunset = this.preset.id === 'sunset';
        const rayColor = cel.rayColor ?? cel.core;
        const rayCount = isSunset ? 8 : 12;
        const rayLength = radius * (isSunset ? 2.6 : 1.6);
        const rayHalfAngle = isSunset ? 0.055 : 0.04;
        const rayAlpha = isSunset ? 0.4 : 0.65;

        ctx.save();
        const haloRadius = radius * (isSunset ? 3.2 : 2.2);
        const halo = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, haloRadius);
        halo.addColorStop(0, withAlpha(cel.glow, isSunset ? 0.45 : 0.5));
        halo.addColorStop(1, withAlpha(cel.glow, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
        ctx.fill();

        for (let i = 0; i < rayCount; i++) {
            const angle = this.celestial.rotation + (i / rayCount) * Math.PI * 2;
            this.paintSunRay(
                ctx,
                cx,
                cy,
                radius,
                angle,
                rayLength,
                rayHalfAngle,
                rayColor,
                rayAlpha,
            );
        }

        ctx.beginPath();
        ctx.fillStyle = cel.core;
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    /**
     * Один луч-спица: клин от края диска к точке, залитый ровной полупрозрачной
     * заливкой (не градиентом — иначе на закате с ~8 лучами статичный слой строил бы
     * лишний десяток `createLinearGradient` на каждый ресайз без видимой пользы).
     * Мягкость закатных лучей — за счёт большей длины и меньшей альфы, не блюра.
     */
    private paintSunRay(
        ctx: CanvasRenderingContext2D,
        cx: number,
        cy: number,
        baseRadius: number,
        angle: number,
        length: number,
        halfAngle: number,
        color: string,
        alpha: number,
    ): void {
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        const tipX = cx + dirX * (baseRadius + length);
        const tipY = cy + dirY * (baseRadius + length);
        ctx.beginPath();
        ctx.moveTo(
            cx + Math.cos(angle - halfAngle) * baseRadius,
            cy + Math.sin(angle - halfAngle) * baseRadius,
        );
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(
            cx + Math.cos(angle + halfAngle) * baseRadius,
            cy + Math.sin(angle + halfAngle) * baseRadius,
        );
        ctx.closePath();
        ctx.fillStyle = withAlpha(color, alpha);
        ctx.fill();
    }

    /**
     * Луна серпом: полный диск, затем «откушенный» смещённым кругом, залитым ТЕМ ЖЕ
     * градиентом неба (`skyGradient`, тот же объект, что красит фон) — воспроизводит
     * цвет неба в месте укуса аналитически, без `destination-out`, который стирал бы
     * и то, что уже нарисовано под диском на статичном слое, а не только сам диск.
     */
    private paintMoon(
        ctx: CanvasRenderingContext2D,
        cx: number,
        cy: number,
        radius: number,
        cel: TCelestialPreset,
        skyGradient: CanvasGradient,
    ): void {
        ctx.save();
        const haloRadius = radius * 2;
        const halo = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, haloRadius);
        halo.addColorStop(0, withAlpha(cel.glow, 0.35));
        halo.addColorStop(1, withAlpha(cel.glow, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = cel.core;
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        const offset = radius * 0.55;
        ctx.beginPath();
        ctx.fillStyle = skyGradient;
        ctx.arc(cx + offset, cy - offset * 0.2, radius * 0.92, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    /**
     * Звёзды ночи — точки от сида в статичном слое, не мерцают и не двигаются между
     * кадрами. Квадратики, а не дуги: под пиксельную тему и без лишнего сглаживания.
     */
    private paintStars(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        cel: TCelestialPreset,
    ): void {
        ctx.save();
        ctx.fillStyle = cel.starColor ?? '#ffffff';
        for (const star of this.stars) {
            ctx.globalAlpha = star.alpha;
            ctx.fillRect(star.xFrac * width, star.yFrac * height, star.size, star.size);
        }
        ctx.restore();
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
        const bottom = Math.round(height * MOUNTAIN_HORIZON_FRAC);
        const top = bottom - bandHeight;
        // Контур 1 px по обращённому к светилу склону (#545, §6): силуэт в тоне каймы
        // рисуется со сдвигом на сторону светила и на 1 px вверх, затем перекрывается
        // основным силуэтом — наружу торчит ровно кромка ридж-линии, обращённая к свету.
        const edge = this.ensureEdgeMountain(image);
        if (edge) {
            // Сторона, обращённая к светилу = обратная направлению света (dx). Свет
            // идёт ОТ светила, поэтому склон, обращённый к нему, — со стороны −sign(dx).
            const rimDx = -Math.sign(computeLightDirection(this.celestial).dx) || 1;
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.drawImage(edge, rimDx, top - 1, width, bandHeight);
            ctx.restore();
        }
        ctx.drawImage(source, 0, top, width, bandHeight);
    }

    /**
     * Силуэт гор, перекрашенный в тон каймы светила (#545) через `source-in` — как
     * `ensureTintedMountain`, но цветом кромки, а не тоном пресета. Кешируется: тон
     * зависит только от пресета. null — offscreen недоступен (контур не рисуем).
     */
    private ensureEdgeMountain(image: HTMLImageElement): HTMLCanvasElement | null {
        if (this.mountainEdgeCanvas) return this.mountainEdgeCanvas;
        const canvas = this.createCanvas();
        canvas.width = image.width;
        canvas.height = image.height;
        const edgeCtx = canvas.getContext('2d');
        if (!edgeCtx) return null;
        edgeCtx.drawImage(image, 0, 0);
        edgeCtx.globalCompositeOperation = 'source-in';
        edgeCtx.fillStyle = edgeHighlightColor(this.preset);
        edgeCtx.fillRect(0, 0, image.width, image.height);
        this.mountainEdgeCanvas = canvas;
        return canvas;
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
        const dpr = getDevicePixelRatio();
        const devicePixel = 1 / dpr;
        // Базовый размер — из МАСШТАБА МИРА (`cloudSpriteWidth` = `WORLD_UNITS.cloudWidth`
        // × `computeWorldScale`), той же геометрии, что у танка (#572). Прежняя доля
        // ширины экрана (0.15) на 1920 давала облако в три корпуса танка: небо и арена
        // жили по разным законам. Каждое облако домножает базу на свой `scale`,
        // выведенный из высоты (`cloud.scale`).
        const baseWidth = cloudSpriteWidth(width);
        // Низ облака не должен заходить за силуэт дальних гор (#572): облака рисуются
        // ПОВЕРХ статичного слоя с горами, и при `yFrac` у нижней границы низ спрайта
        // перекрывал бы силуэт. Ограничиваем именно низ облака, а не его верх.
        const horizonPx = height * MOUNTAIN_HORIZON_FRAC;
        for (const cloud of this.field) {
            const image = this.images[cloud.sprite];
            if (!image || !image.width || !image.height) continue;
            const spriteWidth = Math.max(1, Math.round(baseWidth * cloud.scale));
            // Вертикальное сжатие по плану (#572): слой под острым углом сплющен, поэтому
            // далёкие облака — плоские полоски, а не те же клубы помельче.
            const spriteHeight = Math.max(
                1,
                Math.round(((image.height * spriteWidth) / image.width) * cloud.squashY),
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
            const travelled =
                snapToDevicePixel(cloud.xFrac * span, dpr) + direction * steps * devicePixel;
            const x = wrapOffset(travelled, span) - spriteWidth;
            const rawY = Math.min(height * cloud.yFrac, horizonPx - spriteHeight);
            const y = snapToDevicePixel(rawY, dpr);
            // Прозрачность по плану (#572): у горизонта облако бледнее — воздушная дымка.
            // Множитель поверх альфы пресета, поэтому день/закат/ночь сохраняют свой тон.
            ctx.globalAlpha = this.preset.cloudAlpha * cloud.alpha;
            // Зеркалим через отрицательную ширину назначения (валидно по спеке Canvas
            // 2D): drawImage сам разворачивает спрайт, не трогая матрицу трансформации —
            // ctx.scale(-1,1) сдвинул бы систему координат для всех кадров после этого
            // облака и путал бы x/y остальных вызовов в той же ctx.save()-секции.
            if (cloud.mirror) {
                ctx.drawImage(image, x + spriteWidth, y, -spriteWidth, spriteHeight);
            } else {
                ctx.drawImage(image, x, y, spriteWidth, spriteHeight);
            }
        }
        ctx.restore();
    }
}
