import { createSeededRandom } from '@/shared/lib/random';
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
 * Детерминированно кладёт светило в разумный сектор неба по сиду боя — бои
 * различаются, но солнце не оказывается за краем экрана или под линией гор.
 */
export function pickCelestialGeometry(
    seed: number | string,
    presetId: TSkyPresetId,
): TCelestialGeometry {
    const random = createSeededRandom(`${seed}::celestial`);
    const [yMin, yMax] = CELESTIAL_Y_RANGE[presetId];
    const [rMin, rMax] = CELESTIAL_RADIUS_RANGE[presetId];
    return {
        xFrac: X_MIN + random() * (X_MAX - X_MIN),
        yFrac: yMin + random() * (yMax - yMin),
        radiusFrac: rMin + random() * (rMax - rMin),
        rotation: random() * Math.PI * 2,
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
