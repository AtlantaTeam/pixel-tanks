import { createSeededRandom } from '@/shared/lib/random';
import { MOUNTAIN_HORIZON_FRAC } from './cloud-field';
import type { TSkyPresetId } from './sky-preset';

/**
 * Геометрия и звёзды светила (#519): позиция/размер солнца-луны и разброс звёзд
 * считаются от сида боя отдельными потоками RNG (`::celestial`/`::stars`) — тот же
 * приём изоляции, что у `pickSkyPreset`/`buildCloudField`, чтобы выбор не сдвигал
 * последовательность рельефа/ветра/бота (иначе разошёлся бы реплей). Палитра —
 * в `sky-preset.ts`: пресет отвечает за цвет, этот модуль — за то, где и какого
 * размера светило стоит.
 */

/** Положение и размер светила в статичном слое (доли ширины/высоты канваса). */
export type TCelestialGeometry = {
    xFrac: number;
    yFrac: number;
    /** Радиус диска как доля `min(width, height)` — не раздувается на широком экране. */
    radiusFrac: number;
    /** Статичный угол разворота лучей-спиц, радианы. Не анимируется (issue #519: начать со статичных лучей). */
    rotation: number;
};

/** Точка звёздного поля — только пресет «ночь». */
export type TStarInstance = {
    xFrac: number;
    yFrac: number;
    /** Сторона точки в CSS-px. */
    size: number;
    alpha: number;
};

/**
 * Сектор Y по пресету: день — высоко в небе, закат — низко у горизонта (силуэт гор
 * начинается на 0.62 высоты, `sky-scene.ts`, — солнце уходит за них частично), ночь —
 * луна выше горизонта.
 *
 * Верхняя граница здесь — только художественный потолок сектора. Фактический потолок
 * считает `maxCelestialYFrac` из линии гор и радиуса диска: горы — ПОЛОСА
 * `[0.46 … 0.62]`, а не заливка до низа канваса, поэтому всё, что провалилось ниже
 * `MOUNTAIN_HORIZON_FRAC`, силуэт не перекрывает и оно висит отдельным куском под
 * хребтом (#583).
 *
 * Нижняя граница 0.26 — НЕ художественный выбор, а зазор под верхний HUD: канвас
 * неба растянут на весь экран (`inset:0`), а HUD — оверлей ПОВЕРХ него, а не сосед
 * по layout (`arena-insets.ts`), и движок неба этих инсетов не читает (в отличие
 * от рельефа, который под них подстраивается через `computeTerrainHeights`).
 * Замер живых кадров — верхний оверлей занимает **до ~0.24** высоты канваса на
 * планшетном брейкпоинте (768, тот же диапазон, где #538 нашёл рассинхрон панели
 * с заявленным инсетом). Светило — одиночная точка, не поле из 3–10 инстансов, как
 * облака: если оно попадёт под HUD, бой останется без светила целиком, а не с
 * одним пропавшим экземпляром из многих. 0.26 держит запас над измеренным HUD.
 */
const CELESTIAL_Y_RANGE: Record<TSkyPresetId, readonly [number, number]> = {
    day: [0.26, 0.4],
    sunset: [0.4, 0.56],
    night: [0.26, 0.42],
};

/** Радиус диска относительно `min(width, height)`: закатное солнце крупнее, луна мельче. */
const CELESTIAL_RADIUS_RANGE: Record<TSkyPresetId, readonly [number, number]> = {
    day: [0.045, 0.06],
    sunset: [0.075, 0.095],
    night: [0.035, 0.05],
};

const X_MIN = 0.14;
const X_MAX = 0.86;

/**
 * Запас между низом диска и линией гор. Нужен, потому что горы рисуются по
 * округлённой до пикселя полосе (`Math.round(height * MOUNTAIN_HORIZON_FRAC)`), а
 * контур ридж-линии ещё и сдвинут на 1 px, — впритык к горизонту диск мог бы
 * показать кромку в один пиксель на части высот канваса.
 */
export const CELESTIAL_HORIZON_MARGIN_FRAC = 0.01;

/**
 * Потолок высоты светила: ниже него нижний край диска вылезает из-под силуэта гор
 * (#583). Выводится из линии гор и фактического радиуса, а не задаётся константой
 * рядом с комментарием про горизонт, — иначе правило живёт в комментарии, а не в
 * арифметике, и правка любого из диапазонов молча его ломает.
 *
 * `radiusFrac` — доля `min(width, height)`, а `yFrac` — доля высоты, поэтому в долях
 * высоты диск НЕ больше `radiusFrac` (равенство — на альбомном канвасе, где
 * `min = height`). Значит вычитание радиуса из горизонта — консервативная граница,
 * верная на любой пропорции экрана.
 *
 * `Math.min` с художественным потолком сектора: у дня и ночи диск мелкий и упирается
 * в собственный сектор раньше горизонта, — их вид не меняется. `Math.max` с нижней
 * границей — НЕ подстраховка, а осознанный приоритет: сектор важнее горизонта, см.
 * ниже про закат.
 *
 * **Барьер держит ДИСК, а не всё светило — это принятый размен, а не недосмотр.**
 * `paintSun` рисует вокруг диска ореол радиусом `radius · 3.2` и лучи до `radius · 3.6`
 * (`sky-scene.ts`), так что видимое пятно втрое больше того, что здесь вычитается.
 * Считать потолок по полному габариту нельзя арифметически: на закате это дало бы
 * `0.62 − 3.6 · 0.095 − 0.01 = 0.268`, тогда как нижняя граница сектора — `0.4`.
 * Солнце прижалось бы к верху сектора, потеряло разброс высот по сидам — и всё равно
 * не уложилось бы. То есть выбор не между «правильно» и «неправильно», а между
 * «диск под силуэтом, лучи местами ниже» и «одинаковый закат во всех боях».
 *
 * Почему это терпимо: диск непрозрачен, и именно его кромка читается как отдельный
 * кусок под хребтом (#583). Лучи идут с `alpha 0.4`, ореол гаснет градиентом к краю —
 * под силуэтом они дают слабое свечение, а не второй объект. Если решим убрать и это,
 * правильный рычаг — клип отрисовки по линии гор в `paintSun`, а не потолок высоты;
 * такая правка меняет вид и требует пересъёмки эталонов визрегрессии (issue #602).
 */
export function maxCelestialYFrac(presetId: TSkyPresetId, radiusFrac: number): number {
    const [yMin, yMax] = CELESTIAL_Y_RANGE[presetId];
    const horizonLimit = MOUNTAIN_HORIZON_FRAC - radiusFrac - CELESTIAL_HORIZON_MARGIN_FRAC;
    return Math.max(yMin, Math.min(yMax, horizonLimit));
}

/**
 * Детерминированно кладёт светило в разумный сектор неба по сиду боя — бои
 * различаются, но солнце не оказывается за краем экрана или под линией гор.
 *
 * Высота выбирается ПОСЛЕ радиуса — из потолка, который от этого радиуса зависит.
 * Альтернатива (клэмпить готовый `yFrac`) сплющила бы верхнюю часть сидов в одну и ту
 * же высоту, и закатное небо стало бы однообразным.
 *
 * Порядок ВЫБОРКИ из RNG при этом прежний (x, y, радиус, поворот): значения тянутся
 * сырыми долями `[0, 1)`, а в диапазоны раскладываются уже после. Это держит пресеты
 * `day`/`night` попиксельно теми же, что и до #583, — у них горизонт не связывает.
 */
export function pickCelestialGeometry(
    seed: number | string,
    presetId: TSkyPresetId,
): TCelestialGeometry {
    const random = createSeededRandom(`${seed}::celestial`);
    const xRoll = random();
    const yRoll = random();
    const radiusRoll = random();
    const rotation = random() * Math.PI * 2;

    const [yMin] = CELESTIAL_Y_RANGE[presetId];
    const [rMin, rMax] = CELESTIAL_RADIUS_RANGE[presetId];
    const radiusFrac = rMin + radiusRoll * (rMax - rMin);
    const yMax = maxCelestialYFrac(presetId, radiusFrac);

    return {
        xFrac: X_MIN + xRoll * (X_MAX - X_MIN),
        yFrac: yMin + yRoll * (yMax - yMin),
        radiusFrac,
        rotation,
    };
}

const STAR_DENSITY_STEP_PX = 24;
export const STAR_COUNT_MIN = 28;
export const STAR_COUNT_MAX = 90;

/** Верхняя граница звёздного поля — звёзды не спускаются к силуэту гор (0.62 высоты). */
const STAR_Y_MAX = 0.56;

/** Сколько звёзд на поле такой ширины: гуще на широком экране, но с потолком. */
export function starCount(width: number): number {
    if (!Number.isFinite(width) || width <= 0) return STAR_COUNT_MIN;
    const raw = Math.round(width / STAR_DENSITY_STEP_PX);
    return Math.min(STAR_COUNT_MAX, Math.max(STAR_COUNT_MIN, raw));
}

/**
 * Разбрасывает звёзды по сиду боя. Плотность зависит от ширины (как поле облаков),
 * поэтому пересобирается при ресайзе — вызывающая сторона (`SkyScene`) решает, звать
 * ли (только для ночного пресета).
 */
export function buildStarField(seed: number | string, width: number): TStarInstance[] {
    const random = createSeededRandom(`${seed}::stars`);
    const count = starCount(width);
    const stars: TStarInstance[] = [];
    for (let i = 0; i < count; i++) {
        stars.push({
            xFrac: random(),
            yFrac: random() * STAR_Y_MAX,
            size: random() < 0.75 ? 1 : 2,
            alpha: 0.35 + random() * 0.65,
        });
    }
    return stars;
}

/**
 * Добавляет альфа-канал к 6-значному hex-цвету пресета — восьмизначный hex, тот же
 * формат, что уже несёт прозрачность в `TWeaponExplosionColors` (`weapon-specs.ts`),
 * Canvas 2D понимает его нативно без промежуточного `rgba(...)`.
 */
export function withAlpha(hex: string, alpha: number): string {
    const clamped = Math.min(1, Math.max(0, alpha));
    const alphaHex = Math.round(clamped * 255)
        .toString(16)
        .padStart(2, '0');
    return `${hex}${alphaHex}`;
}
