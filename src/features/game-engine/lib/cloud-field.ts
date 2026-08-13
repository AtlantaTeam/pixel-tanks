import { createSeededRandom } from '@/shared/lib/random';

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

/** Облако поля: какой спрайт, где стоит и с какой скоростью плывёт. */
export type TCloudInstance = {
    sprite: TCloudSpriteKey;
    /** Стартовая позиция как доля ширины поля, [0, 1). */
    xFrac: number;
    /** Верх облака как доля высоты канваса, [0, 1). */
    yFrac: number;
    /** Скорость параллакса, px/мс. */
    speed: number;
};

/**
 * Одно облако примерно на столько CSS-пикселей ширины. Замер одобренного кадра:
 * четыре облака на 1280 CSS — то есть шаг около 320. Отсюда и разреженность: плотность
 * задаётся шагом, а не тем, сколько облаков поместилось в ленту.
 */
export const CLOUD_DENSITY_STEP_PX = 320;

/** Границы числа облаков: на узком экране их не должно остаться ноль, на широком — сотня. */
export const CLOUD_COUNT_MIN = 3;
export const CLOUD_COUNT_MAX = 10;

/**
 * Скорости параллакса, px/мс. Разные скорости у соседних облаков и есть глубина:
 * дальние отстают. Раньше скорость была одна на всю ленту — потому движение и читалось
 * как рывок целого слоя.
 */
export const CLOUD_SPEEDS = [0.004, 0.009, 0.016] as const;

/** Вертикальный разброс: облака живут в верхней части неба, над рельефом. */
const Y_MIN = 0.04;
const Y_MAX = 0.34;

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
        field.push({
            sprite: SPRITE_KEYS[Math.floor(random() * SPRITE_KEYS.length) % SPRITE_KEYS.length],
            xFrac: (i + jitter) / count,
            yFrac: Y_MIN + random() * (Y_MAX - Y_MIN),
            speed: CLOUD_SPEEDS[Math.floor(random() * CLOUD_SPEEDS.length) % CLOUD_SPEEDS.length],
        });
    }
    return field;
}
