import { describe, expect, it } from 'vitest';
import { MAX_WIND } from './wind';
import {
    buildWindDustField,
    windDustCount,
    WIND_DUST_BAND_MAX,
    WIND_DUST_BAND_MIN,
} from './wind-dust';

describe('windDustCount — плотность от силы ветра (#550)', () => {
    it('wind = 0 → пылинок нет', () => {
        expect(windDustCount(0)).toBe(0);
    });

    it('растёт с силой ветра', () => {
        const weak = windDustCount(MAX_WIND / 3);
        const strong = windDustCount(MAX_WIND);
        expect(strong).toBeGreaterThan(weak);
        expect(weak).toBeGreaterThan(0);
    });

    it('знак ветра не влияет на плотность — только модуль', () => {
        expect(windDustCount(-MAX_WIND)).toBe(windDustCount(MAX_WIND));
    });
});

describe('buildWindDustField — раскладка (#550)', () => {
    it('wind = 0 → пустое поле (критерий #550)', () => {
        expect(buildWindDustField(42, 0)).toEqual([]);
    });

    it('детерминировано по сиду: тот же сид — та же раскладка', () => {
        const a = buildWindDustField(42, MAX_WIND);
        const b = buildWindDustField(42, MAX_WIND);
        expect(a).toEqual(b);
    });

    it('разные сиды дают разную раскладку', () => {
        const a = buildWindDustField(1, MAX_WIND);
        const b = buildWindDustField(2, MAX_WIND);
        expect(a).not.toEqual(b);
    });

    it('позиции лежат в приземной полосе по Y', () => {
        const field = buildWindDustField(7, MAX_WIND);
        expect(field.length).toBeGreaterThan(0);
        for (const p of field) {
            expect(p.yFrac).toBeGreaterThanOrEqual(WIND_DUST_BAND_MIN);
            expect(p.yFrac).toBeLessThanOrEqual(WIND_DUST_BAND_MAX);
        }
    });

    it('число частиц соответствует windDustCount', () => {
        expect(buildWindDustField(7, MAX_WIND)).toHaveLength(windDustCount(MAX_WIND));
    });
});
