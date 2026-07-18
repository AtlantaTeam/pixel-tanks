import type { TSeededRandom } from '@/shared/lib/random';

export const MAX_WIND = 0.01;

/**
 * Ветер матча: постоянное боковое ускорение снаряда (px/тик²),
 * детерминированное значение в [-MAX_WIND, MAX_WIND] из seeded-генератора.
 * Знак = направление: положительный сносит вправо, отрицательный — влево.
 */
export const generateWind = (random: TSeededRandom, maxWind = MAX_WIND): number =>
    (random() * 2 - 1) * maxWind;
