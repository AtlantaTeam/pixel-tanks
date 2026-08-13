import { pickCelestialGeometry, type TCelestialGeometry } from './sky-celestial';
import { pickSkyPreset, type TSkyPreset, type TSkyPresetId } from './sky-preset';

/**
 * Свет от светила (#545): направление света, тень танка, подсветка кромок и тонировка
 * земли — «включатель» времени суток из §6 разбора #534. Модель чистая и
 * детерминирована сидом боя: светило (`sky-celestial.ts`) и пресет (`sky-preset.ts`)
 * выводятся из того же сида, что и небо (`SkyBackground`), поэтому направление света в
 * рельефном канвасе совпадает с положением диска в канвасе неба — без связи между
 * двумя слоями, только через общий сид.
 *
 * Здесь только математика и палитра композита; само рисование теней/кромок/тона —
 * в `Ground` (земля) и `GamePlay`/`Tank` (тени), как рендер отделён от состояния в
 * остальном движке (`.claude/rules/canvas.md`).
 */

/**
 * Центр арены в долях канваса. Свет идёт от светила К центру, поэтому знак
 * горизонтальной составляющей направления противоположен знаку смещения светила от
 * центра — тень падает в сторону, обратную светилу (критерий #545). Вертикаль (0.68)
 * — примерно уровень рельефа/танков под линией гор (0.62); на знак горизонтального
 * смещения тени она не влияет, задаёт лишь наклон луча для длины тени.
 */
export const ARENA_CENTER = { xFrac: 0.5, yFrac: 0.68 } as const;

/** Нормализованный вектор направления света: от светила к центру арены. */
export type TLightDirection = { dx: number; dy: number };

/**
 * Направление света — единичный вектор от светила к центру арены. Горизонтальная
 * компонента `dx` несёт сторону тени: светило справа (`xFrac > 0.5`) → `dx < 0` →
 * тень влево, и наоборот. Ровно по центру (вырожденный случай, мера ноль на
 * непрерывном сиде) — `dx === 0`.
 */
export function computeLightDirection(celestial: TCelestialGeometry): TLightDirection {
    const lx = ARENA_CENTER.xFrac - celestial.xFrac;
    const ly = ARENA_CENTER.yFrac - celestial.yFrac;
    const len = Math.hypot(lx, ly) || 1;
    return { dx: lx / len, dy: ly / len };
}

/**
 * Слой тонировки земли: цвет и альфа. Композитится поверх песка через `source-atop`
 * (только силуэт рельефа), как задаёт §6 («плоский слой поверх рельефа»). Несколько
 * слоёв на пресет — закат кладёт тёплый тон и отдельный тон в тени.
 */
export type TGroundTintLayer = { color: string; alpha: number };

/**
 * Тонировка земли по пресету (§6, п.1). День — без тонировки (песок читается ярким,
 * как полдень). Закат — глубокий красно-оранжевый тон вечера (`#d9713e`, цвет самого
 * закатного неба) плюс мадженты в тень (`#c900ff`). Ночь — тёмный сине-зелёный тон.
 * Значения подобраны так, чтобы средний цвет вырезки песка различался между пресетами
 * на ΔE > 15 (критерий #545 / §6) — см. `scene-light.test.ts`.
 */
export const GROUND_TINT: Record<TSkyPresetId, readonly TGroundTintLayer[]> = {
    day: [],
    sunset: [
        { color: '#d9713e', alpha: 0.3 },
        { color: '#c900ff', alpha: 0.08 },
    ],
    night: [{ color: '#101711', alpha: 0.3 }],
};

/** Цвет RGB (0..255) как тройка чисел — промежуточное представление для композита/ΔE. */
export type TRgb = readonly [number, number, number];

/** Парсит 6-значный hex (`#rrggbb`) в RGB. Альфу не читает — она отдельным параметром. */
export function hexToRgb(hex: string): TRgb {
    const clean = hex.replace('#', '');
    return [
        parseInt(clean.slice(0, 2), 16),
        parseInt(clean.slice(2, 4), 16),
        parseInt(clean.slice(4, 6), 16),
    ];
}

/** Кладёт полупрозрачный цвет `tint` (альфа `alpha`) поверх `base` — как `source-over` в Canvas. */
function overRgb(base: TRgb, tint: TRgb, alpha: number): TRgb {
    const a = Math.min(1, Math.max(0, alpha));
    return [
        base[0] * (1 - a) + tint[0] * a,
        base[1] * (1 - a) + tint[1] * a,
        base[2] * (1 - a) + tint[2] * a,
    ];
}

/**
 * Композитит тонировку пресета поверх базового цвета песка — модель того, что делает
 * Canvas при отрисовке тона на слое рельефа (последовательный `source-over` с
 * `globalAlpha`). Возвращает средний цвет вырезки песка для этого пресета, из которого
 * тест считает ΔE между пресетами (критерий #545).
 */
export function applyGroundTint(baseSand: TRgb, presetId: TSkyPresetId): TRgb {
    let color = baseSand;
    for (const layer of GROUND_TINT[presetId]) {
        color = overRgb(color, hexToRgb(layer.color), layer.alpha);
    }
    return color;
}

/**
 * Средний цвет отрисованного песка в бою — оранжевая заливка рельефа под текстурой
 * `sand.jpg` при `globalAlpha 0.6` (`Ground.decorateWithSand`). Замер: текстура даёт
 * ≈(203,142,78), поверх оранжевого (`#ffa500`) с альфой 0.6 композит ≈(224,151,47).
 * База тонировки в тесте ΔE — именно этот композит, а не голая текстура.
 */
export const BASE_SAND_RGB: TRgb = [224, 151, 47];

/** Одна компонента sRGB (0..255) → линейный свет (0..1). */
function srgbToLinear(channel: number): number {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** RGB (0..255) → CIE L*a*b* (D65) — пространство, в котором ΔE меряет воспринимаемую разницу. */
export function rgbToLab(rgb: TRgb): [number, number, number] {
    const r = srgbToLinear(rgb[0]);
    const g = srgbToLinear(rgb[1]);
    const b = srgbToLinear(rgb[2]);
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x);
    const fy = f(y);
    const fz = f(z);
    x = fx;
    z = fz;
    return [116 * fy - 16, 500 * (x - fy), 200 * (fy - z)];
}

/** ΔE (CIE76) — евклидово расстояние в Lab. > 15 читается как явно различимый цвет. */
export function deltaE(a: TRgb, b: TRgb): number {
    const la = rgbToLab(a);
    const lb = rgbToLab(b);
    return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/**
 * Тон подсветки кромок (кайма светила): у солнца — цвет лучей/каймы (`rayColor`),
 * у луны — цвет диска. Им подсвечивается верхняя кромка песка и обращённый к светилу
 * склон дальних гор (§6, п.3).
 */
export function edgeHighlightColor(preset: TSkyPreset): string {
    const cel = preset.celestial;
    return cel.rayColor ?? cel.core;
}

/**
 * Сводка света сцены для боя (`GamePlay`): пресет, геометрия светила, направление
 * света, тонировка земли и цвет подсветки кромок — всё из одного сида. Собирается один
 * раз на бой (пресет/геометрия постоянны), как поле облаков и ветер.
 */
export type TSceneLight = {
    preset: TSkyPreset;
    celestial: TCelestialGeometry;
    direction: TLightDirection;
    groundTint: readonly TGroundTintLayer[];
    edgeColor: string;
};

/** Собирает модель света боя из сида — детерминированно, тем же сидом, что и небо. */
export function computeSceneLight(seed: number | string): TSceneLight {
    const preset = pickSkyPreset(seed);
    const celestial = pickCelestialGeometry(seed, preset.id);
    return {
        preset,
        celestial,
        direction: computeLightDirection(celestial),
        groundTint: GROUND_TINT[preset.id],
        edgeColor: edgeHighlightColor(preset),
    };
}
