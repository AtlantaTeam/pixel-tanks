import { createSeededRandom } from '@/shared/lib/random';
import { MAX_WIND } from './wind';

/**
 * Поле отдельных облаков — то, что показано в одобренном кадре
 * `docs/game-visuals/iteration-2/live-desktop.png`: крупные облака поштучно разбросаны
 * по небу, между ними пустое небо, у каждого своя высота и своя скорость.
 *
 * Прежняя реализация клала бесшовную ЛЕНТУ (`clouds-far/near.png`) и повторяла её по
 * горизонтали. Отсюда две жалобы приёмки (#514): небо получалось плотным, без
 * разреженности, а движение «передёргивало» — вся полоса ехала одним куском, и глазу
 * не за что зацепиться, кроме шва повтора. Спрайты `cloud-1..3.png` при этом лежали
 * в `public/art/` неиспользованными.
 */

export type TCloudSpriteKey = 'cloud1' | 'cloud2' | 'cloud3';

const SPRITE_KEYS: readonly TCloudSpriteKey[] = ['cloud1', 'cloud2', 'cloud3'];

/** Облако поля: какой спрайт, где стоит, с какой скоростью и в каком размере плывёт. */
export type TCloudInstance = {
    sprite: TCloudSpriteKey;
    /** Стартовая позиция как доля ширины поля, [0, 1). */
    xFrac: number;
    /** Верх облака как доля высоты канваса, [0, 1). */
    yFrac: number;
    /** Скорость параллакса, px/мс. */
    speed: number;
    /** Множитель размера спрайта относительно базового (`cloudSpriteWidth`), [CLOUD_SCALE_MIN, CLOUD_SCALE_MAX]. */
    scale: number;
    /** Зеркалить спрайт по X при отрисовке — те же три спрайта дают шесть силуэтов. */
    mirror: boolean;
};

/**
 * Одно облако примерно на столько CSS-пикселей ширины. Замер одобренного кадра:
 * четыре облака на 1280 CSS — то есть шаг около 320. Отсюда и разреженность: плотность
 * задаётся шагом, а не тем, сколько облаков поместилось в ленту.
 */
export const CLOUD_DENSITY_STEP_PX = 320;

/** Границы числа облаков: на узком экране их не должно остаться ноль, на широком —
 *  не больше десятка (потолок держит и читаемость неба, и бюджет кадра). */
export const CLOUD_COUNT_MIN = 3;
export const CLOUD_COUNT_MAX = 10;

/**
 * Скорости параллакса, px/мс. Разные скорости у соседних облаков и есть глубина:
 * дальние отстают. Раньше скорость была одна на всю ленту — потому движение и читалось
 * как рывок целого слоя.
 */
export const CLOUD_SPEEDS = [0.004, 0.009, 0.016] as const;

/**
 * Вертикальный разброс: облака живут в верхней части неба, над рельефом. Расширен с
 * прежних 0.04–0.34 (#514) — в одобренном эталоне облака стоят и заметно ниже, вплотную
 * к силуэту гор (горы начинаются на ~0.62 высоты, `sky-scene.ts`), а не только у самого
 * верха кадра.
 */
const Y_MIN = 0.04;
const Y_MAX = 0.48;

/**
 * Ярусы глубины: масштаб облака связан со скоростью, а не берётся отдельным random.
 * Мелкое — оно же дальнее — оно же медленное, тогда глаз читает планы (#515, гипотеза
 * приёмки «нет разброса»). Диапазоны соседних ярусов пересекаются нарочно — иначе поле
 * выглядело бы как три чётких пресета размера, а не живой разброс.
 */
const CLOUD_DEPTHS: ReadonlyArray<{ speed: number; scaleMin: number; scaleMax: number }> = [
    { speed: CLOUD_SPEEDS[0], scaleMin: 0.55, scaleMax: 0.85 },
    { speed: CLOUD_SPEEDS[1], scaleMin: 0.75, scaleMax: 1.1 },
    { speed: CLOUD_SPEEDS[2], scaleMin: 1.0, scaleMax: 1.4 },
];

/** Границы масштаба облака по всем ярусам — для тестов и внешних проверок. */
export const CLOUD_SCALE_MIN = Math.min(...CLOUD_DEPTHS.map((d) => d.scaleMin));
export const CLOUD_SCALE_MAX = Math.max(...CLOUD_DEPTHS.map((d) => d.scaleMax));

/**
 * Дрейф при штиле: при нулевом ветре облака не встают колом, а еле ползут. Ноль
 * выглядел бы поломкой («небо замерло»), а не безветрием.
 */
const CALM_DRIFT = 0.25;

/** Прибавка к дрейфу при ветре в полную силу (`MAX_WIND`). */
const WIND_GAIN = 1.75;

/**
 * Множитель скорости облаков от ветра боя. Знак — направление: ветер влево несёт
 * облака влево, и небо перестаёт спорить с траекторией снаряда (#518).
 *
 * Нормируется на `MAX_WIND` — тот же потолок, по которому HUD рисует пипы силы.
 * Своя шкала здесь означала бы, что «три пипа» в интерфейсе и «сильный ветер» на небе
 * разъезжаются.
 *
 * Ветер в бою ПОСТОЯНЕН и выведен из сида, поэтому небо дует одинаково весь бой,
 * а от боя к бою по-разному. Менять его в полёте нельзя: он входит в физику снаряда
 * и в реплеи.
 */
export function windFactor(wind: number): number {
    if (!Number.isFinite(wind)) return CALM_DRIFT;
    const strength = Math.min(1, Math.abs(wind) / MAX_WIND);
    const magnitude = CALM_DRIFT + strength * WIND_GAIN;
    return wind < 0 ? -magnitude : magnitude;
}

/**
 * Ширина облака как доля ширины экрана. 15% — замер ОБОИХ одобренных кадров:
 * десктопный `live-desktop.png` даёт 192 CSS-px на 1280 (15%), мобильный
 * `mockup-day.png` — 54 CSS-px на 390 (14%).
 *
 * Фиксированный размер в CSS (как было до #523) на десктопе совпадал с эталоном,
 * а на телефоне занимал **половину ширины**: 192 px из 390, суммарное покрытие неба
 * 148% — облака наезжали друг на друга.
 */
const CLOUD_WIDTH_FRAC = 0.15;

/** Границы: на узком экране облако не вырождается в точку, на широком не раздувается. */
const CLOUD_WIDTH_MIN = 48;
const CLOUD_WIDTH_MAX = 192;

/** Ширина облачного спрайта в CSS-пикселях под текущую ширину канваса. */
export function cloudSpriteWidth(canvasWidth: number): number {
    if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return CLOUD_WIDTH_MIN;
    const raw = Math.round(canvasWidth * CLOUD_WIDTH_FRAC);
    return Math.min(CLOUD_WIDTH_MAX, Math.max(CLOUD_WIDTH_MIN, raw));
}

export function cloudCount(width: number): number {
    if (!Number.isFinite(width) || width <= 0) return CLOUD_COUNT_MIN;
    const raw = Math.round(width / CLOUD_DENSITY_STEP_PX);
    return Math.min(CLOUD_COUNT_MAX, Math.max(CLOUD_COUNT_MIN, raw));
}

/**
 * Раскладывает облака по небу детерминированно от сида: один сид — то же небо
 * (критерий #479). Поток RNG отделён суффиксом `::clouds`, чтобы не сдвинуть
 * последовательность боя (рельеф, ветер, бот) — иначе разошёлся бы реплей.
 *
 * Позиции по X раскладываются по СЕКТОРАМ (`i + jitter`), а не свободным random: при
 * свободном два облака регулярно слипались в кучу, оставляя полнеба пустым, — а нужна
 * ровная разреженность, как в одобренном кадре.
 */
export function buildCloudField(seed: number | string, width: number): TCloudInstance[] {
    const random = createSeededRandom(`${seed}::clouds`);
    const count = cloudCount(width);
    const field: TCloudInstance[] = [];
    for (let i = 0; i < count; i++) {
        const jitter = 0.15 + random() * 0.7;
        const depth =
            CLOUD_DEPTHS[Math.floor(random() * CLOUD_DEPTHS.length) % CLOUD_DEPTHS.length];
        field.push({
            sprite: SPRITE_KEYS[Math.floor(random() * SPRITE_KEYS.length) % SPRITE_KEYS.length],
            xFrac: (i + jitter) / count,
            yFrac: Y_MIN + random() * (Y_MAX - Y_MIN),
            speed: depth.speed,
            scale: depth.scaleMin + random() * (depth.scaleMax - depth.scaleMin),
            mirror: random() < 0.5,
        });
    }
    return field;
}
