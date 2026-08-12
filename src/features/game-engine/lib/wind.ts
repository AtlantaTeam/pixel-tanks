import type { TSeededRandom } from '@/shared/lib/random';

export const MAX_WIND = 0.01;

/**
 * Ветер матча: постоянное боковое ускорение снаряда (px/тик²),
 * детерминированное значение в [-MAX_WIND, MAX_WIND] из seeded-генератора.
 * Знак = направление: положительный сносит вправо, отрицательный — влево.
 */
export const generateWind = (random: TSeededRandom, maxWind = MAX_WIND): number =>
    (random() * 2 - 1) * maxWind;

/** Сторона сноса — знак ветра, читаемо для стрелки ячейки ВЕТЕР (handoff). */
export type TWindDirection = 'left' | 'right';

export const windDirection = (wind: number): TWindDirection => (wind < 0 ? 'left' : 'right');

/** Верх шкалы отображаемой силы ветра: 3 пипа «грубой силы» до пристрелки —
 *  та же шкала даёт точное число после `windRevealed` (handoff «Ветер»),
 *  поэтому у пипов и у раскрытого числа один источник округления. */
export const WIND_DISPLAY_SCALE = 3;

/**
 * Сырой физический ветер (px/тик², диапазон [-MAX_WIND, MAX_WIND]) в целую
 * силу 0..WIND_DISPLAY_SCALE для HUD: знак не участвует (его несёт
 * `windDirection`), только модуль.
 */
export const windMagnitude = (wind: number, maxWind = MAX_WIND): number => {
    if (maxWind <= 0) return 0;
    const ratio = Math.min(1, Math.abs(wind) / maxWind);

    return Math.round(ratio * WIND_DISPLAY_SCALE);
};
