export type TSeededRandom = () => number;

/**
 * Хеш xmur3: превращает строковый seed в 32-битное число.
 */
const hashStringSeed = (seed: string): number => {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
};

/**
 * Детерминированный PRNG mulberry32: один seed — одна последовательность в [0, 1).
 */
export const createSeededRandom = (seed: number | string): TSeededRandom => {
    let state = (typeof seed === 'string' ? hashStringSeed(seed) : seed) >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
