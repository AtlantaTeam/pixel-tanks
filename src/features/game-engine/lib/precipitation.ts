import { createSeededRandom } from '@/shared/lib/random';
import { MAX_WIND } from './wind';
import { hexToRgb, type TGroundTintLayer, type TRgb } from './scene-light';

/**
 * Осадки как погодный пресет (#546, §7.7 разбора #534). Пресет выводится из сида боя,
 * поэтому один сид — та же погода (как рельеф, ветер и небо). Модель чистая и
 * детерминирована: здесь — выбор пресета, поле частиц с неоднородной плотностью,
 * палитра и тонировка рельефа для `prefers-reduced-motion`. Само рисование частиц —
 * в `Precipitation` (`precipitation-scene.ts`), как рендер отделён от состояния в
 * остальном движке (`.claude/rules/canvas.md`).
 *
 * Три правила разбора, без которых пункт не берут в работу, закодированы здесь:
 *  1. плотность в центральной трети арены вдвое ниже, чем по краям (`CENTRAL_*`);
 *  2. гашение на прицеливании — `precipAlphaScale` по сигналу `gestureVisual !== null`
 *     (тот же приём, что у чат-бабла #527);
 *  3. `prefers-reduced-motion` — статика: движения нет, погода читается тонировкой
 *     рельефа (`reducedMotionTint`) и дымкой бури (`reducedMotionHaze`).
 */

export type TPrecipPresetId = 'clear' | 'rain' | 'snow' | 'sandstorm';

/** Форма частицы осадков — под пиксельную тему, целыми пикселями без сглаживания. */
export type TPrecipShape = 'line' | 'square' | 'streak';

export type TPrecipPreset = {
    id: TPrecipPresetId;
    /** Человекочитаемое имя — для витрины `/design-system`. */
    name: string;
    /** Форма частицы; `null` у `clear` — осадков нет, поле частиц пустое. */
    shape: TPrecipShape | null;
    /** Цвет частицы (6-значный hex; альфа задаётся отдельно частицей и гашением). */
    color: string;
    /** Один партикл примерно на столько CSS-пикселей ширины (задаёт плотность поля). */
    densityStepPx: number;
    /** Базовая скорость падения — доля высоты канваса в миллисекунду. */
    fallSpeed: number;
    /**
     * Горизонтальный снос по ветру — доля ширины канваса в миллисекунду при ветре в
     * полную силу (`MAX_WIND`). Знак и модуль сноса каждой частицы — от ветра боя.
     */
    driftSpeed: number;
    /** Тонировка рельефа для `prefers-reduced-motion` (пусто у `clear`). */
    reducedMotionTint: readonly TGroundTintLayer[];
    /** Статичная дымка поверх кадра при `prefers-reduced-motion` (только буря). */
    reducedMotionHaze?: { color: string; alpha: number };
};

/**
 * Границы центральной трети арены по горизонтали — «коридор трассы», где летит снаряд.
 * Плотность частиц в нём вдвое ниже, чем по краям (правило 1 разбора): яркий шум ровно
 * поверх траектории съедал бы её читаемость.
 */
export const CENTRAL_MIN = 1 / 3;
export const CENTRAL_MAX = 2 / 3;

/**
 * Доля частиц, попадающих в центральную треть. Выведена из требования «вдвое ниже
 * плотность»: при весе центра 0.5 и весе краёв 1.0 доля центра =
 * (0.5·⅓)/(0.5·⅓ + 1.0·⅔) = 1/5. Тогда плотность-на-ширину в центре ровно вдвое ниже,
 * чем по краям (`precipitation.test.ts` меряет это по маске).
 */
export const CENTRAL_PROBABILITY = 0.2;

/** Доля частиц дальнего плана: дальний план плотнее ближнего (правило 1 разбора). */
export const FAR_PROBABILITY = 0.62;

/** Границы числа частиц: на узком экране их не ноль, на широком — не бесконечность (FPS). */
export const PRECIP_COUNT_MIN = 24;
export const PRECIP_COUNT_MAX = 140;

/** Множитель альфы частиц при активной оттяжке (гашение на прицеливании, правило 2). */
export const PRECIP_DIM_SCALE = 0.3;

/**
 * Глубина частицы: дальняя мельче, медленнее и бледнее — так поле читается объёмным,
 * а не плоским шумом. Ближняя крупнее и быстрее. Значения — множители к форме/скорости.
 */
const DEPTHS = {
    far: { scale: 0.7, speed: 0.7, alphaMul: 0.55 },
    near: { scale: 1.25, speed: 1.3, alphaMul: 1 },
} as const;

export const PRECIP_PRESETS: readonly TPrecipPreset[] = [
    {
        id: 'clear',
        name: 'Ясно',
        shape: null,
        color: '#000000',
        densityStepPx: Number.POSITIVE_INFINITY,
        fallSpeed: 0,
        driftSpeed: 0,
        reducedMotionTint: [],
    },
    {
        id: 'rain',
        name: 'Дождь',
        shape: 'line',
        color: '#a9cdeb',
        densityStepPx: 9,
        fallSpeed: 0.0016,
        driftSpeed: 0.00035,
        // Мокрый песок темнее (~12%): тёмно-синий тон поверх рельефа.
        reducedMotionTint: [{ color: '#0a1a2a', alpha: 0.14 }],
    },
    {
        id: 'snow',
        name: 'Снег',
        shape: 'square',
        color: '#f4f8ff',
        densityStepPx: 20,
        fallSpeed: 0.0007,
        driftSpeed: 0.0006,
        // Наледь светлее (~8%): белёсый тон поверх рельефа.
        reducedMotionTint: [{ color: '#ffffff', alpha: 0.1 }],
    },
    {
        id: 'sandstorm',
        name: 'Буря',
        shape: 'streak',
        color: '#e2ba74',
        densityStepPx: 7,
        fallSpeed: 0.0004,
        driftSpeed: 0.0022,
        // Пыль оседает на рельеф — тёплый песочный тон.
        reducedMotionTint: [{ color: '#8a6a30', alpha: 0.14 }],
        // Дымка 6% поверх дальнего плана (правило 3 разбора для бури).
        reducedMotionHaze: { color: '#c9a15f', alpha: 0.06 },
    },
];

const PRESET_BY_ID = new Map<string, TPrecipPreset>(
    PRECIP_PRESETS.map((preset) => [preset.id, preset]),
);

/**
 * Детерминированно выбирает погодный пресет по сиду боя. `clear` — ~60% боёв (осадки
 * не должны быть в каждом бою: чаще их нет вовсе). Поток RNG отделён суффиксом
 * `::weather`, чтобы не сдвинуть последовательность боя (рельеф, ветер, бот) — иначе
 * разошёлся бы реплей того же сида.
 */
export const pickPrecipPreset = (seed: number | string): TPrecipPreset => {
    const random = createSeededRandom(`${seed}::weather`);
    const roll = random();
    if (roll < 0.6) return PRESET_BY_ID.get('clear')!;
    const wet: readonly TPrecipPresetId[] = ['rain', 'snow', 'sandstorm'];
    const idx = Math.min(wet.length - 1, Math.floor(((roll - 0.6) / 0.4) * wet.length));
    return PRESET_BY_ID.get(wet[idx])!;
};

/**
 * Пресет по идентификатору — для витрины, где погода показывается принудительно в
 * каждом варианте. Неизвестный id — исключение (fail-closed), а не тихий дефолт.
 */
export const pickPrecipPresetById = (id: TPrecipPresetId): TPrecipPreset => {
    const preset = PRESET_BY_ID.get(id);
    if (!preset) {
        throw new Error(`Неизвестный погодный пресет: ${id}`);
    }
    return preset;
};

/** Число частиц под текущую ширину канваса и пресет (плотность от `densityStepPx`). */
export function precipCount(width: number, preset: TPrecipPreset): number {
    if (!preset.shape || !Number.isFinite(width) || width <= 0) return 0;
    const raw = Math.round(width / preset.densityStepPx);
    return Math.min(PRECIP_COUNT_MAX, Math.max(PRECIP_COUNT_MIN, raw));
}

/** Одна частица осадков: стартовая позиция, глубина и производные множители. */
export type TPrecipParticle = {
    /** Стартовая позиция как доля ширины поля, [0, 1). */
    xFrac: number;
    /** Стартовая позиция как доля высоты канваса, [0, 1). */
    yFrac: number;
    /** Дальний план плотнее и бледнее ближнего. */
    depth: 'far' | 'near';
    /** Множитель размера частицы от глубины. */
    scale: number;
    /** Множитель скорости от глубины. */
    speed: number;
    /** Базовая альфа частицы (до гашения на прицеливании). */
    alpha: number;
    /** Индивидуальный множитель длины линии/штриха, чтобы поле не было гребёнкой. */
    length: number;
};

/**
 * Раскладывает частицы по кадру детерминированно от сида: один сид — та же погода
 * (критерий #479). Поток RNG отделён суффиксом `::precip`, чтобы не сдвинуть
 * последовательность боя.
 *
 * По X — не свободный `random`, а выбор «центр/край» сначала (`CENTRAL_PROBABILITY`),
 * затем равномерно внутри выбранной области: так плотность в центральной трети выходит
 * ровно вдвое ниже краёв (правило 1 разбора), а не «на глаз».
 */
export function buildPrecipField(
    seed: number | string,
    width: number,
    preset: TPrecipPreset,
): TPrecipParticle[] {
    if (!preset.shape) return [];
    const random = createSeededRandom(`${seed}::precip`);
    const count = precipCount(width, preset);
    const field: TPrecipParticle[] = [];
    for (let i = 0; i < count; i++) {
        const inCentral = random() < CENTRAL_PROBABILITY;
        let xFrac: number;
        if (inCentral) {
            xFrac = CENTRAL_MIN + random() * (CENTRAL_MAX - CENTRAL_MIN);
        } else {
            // Две краевые полосы шириной ⅓ каждая: [0, ⅓) и [⅔, 1).
            const r = random() * (2 / 3);
            xFrac = r < 1 / 3 ? r : CENTRAL_MAX + (r - 1 / 3);
        }
        const isFar = random() < FAR_PROBABILITY;
        const depth = isFar ? DEPTHS.far : DEPTHS.near;
        field.push({
            xFrac,
            yFrac: random(),
            depth: isFar ? 'far' : 'near',
            scale: depth.scale,
            speed: depth.speed,
            alpha: 0.55 * depth.alphaMul,
            length: 0.7 + random() * 0.6,
        });
    }
    return field;
}

/** Множитель альфы поля: при активной оттяжке частицы гаснут до `PRECIP_DIM_SCALE`. */
export const precipAlphaScale = (dimmed: boolean): number => (dimmed ? PRECIP_DIM_SCALE : 1);

/**
 * Средняя альфа частиц поля с учётом гашения — модель того, что реально ляжет на канвас
 * (`globalAlpha` домножается на `precipAlphaScale`). Из неё тест проверяет правило 2:
 * при активной оттяжке средняя альфа падает.
 */
export function averageParticleAlpha(field: readonly TPrecipParticle[], dimmed: boolean): number {
    if (field.length === 0) return 0;
    const scale = precipAlphaScale(dimmed);
    return field.reduce((sum, p) => sum + p.alpha * scale, 0) / field.length;
}

/**
 * Нормирует ветер боя (`px/тик²`, [-MAX_WIND, MAX_WIND]) в [-1, 1] — знак несёт сторону
 * сноса частиц, модуль — его силу. Та же шкала, что у пипов силы ветра в HUD и у
 * облаков (`windFactor`): «сильный ветер» на небе, в HUD и в осадках не разъезжается.
 */
export function precipWindNorm(wind: number): number {
    if (!Number.isFinite(wind)) return 0;
    return Math.max(-1, Math.min(1, wind / MAX_WIND));
}

/**
 * Тонировка рельефа для `prefers-reduced-motion` (правило 3 разбора): движения нет,
 * погода читается цветом песка. Пусто, если движение разрешено (тогда погоду несут
 * частицы) или пресет `clear`. Композитится теми же слоями, что тон света сцены (#545).
 */
export function precipGroundTint(
    preset: TPrecipPreset | undefined,
    reducedMotion: boolean,
): readonly TGroundTintLayer[] {
    if (!reducedMotion || !preset) return [];
    return preset.reducedMotionTint;
}

/** Кладёт полупрозрачный `tint` (альфа `alpha`) поверх `base` — как `source-over` Canvas. */
function overRgb(base: TRgb, tint: TRgb, alpha: number): TRgb {
    const a = Math.min(1, Math.max(0, alpha));
    return [
        base[0] * (1 - a) + tint[0] * a,
        base[1] * (1 - a) + tint[1] * a,
        base[2] * (1 - a) + tint[2] * a,
    ];
}

/**
 * Средний цвет вырезки песка после reduced-motion-тонировки пресета — модель того, что
 * рисует `Ground.applyTint`. Из неё тест считает ΔE между пресетами (погода должна
 * опознаваться по цвету рельефа, критерий #546).
 */
export function precipTintedSand(base: TRgb, preset: TPrecipPreset): TRgb {
    let color = base;
    for (const layer of preset.reducedMotionTint) {
        color = overRgb(color, hexToRgb(layer.color), layer.alpha);
    }
    return color;
}
