import type { TSeededRandom } from '@/shared/lib/random';

export const MAX_WIND = 0.01;

/**
 * Ветер матча: детерминированное значение в [-MAX_WIND, MAX_WIND] из seeded-генератора.
 */
export const generateWind = (random: TSeededRandom, maxWind = MAX_WIND): number =>
    (random() * 2 - 1) * maxWind;
