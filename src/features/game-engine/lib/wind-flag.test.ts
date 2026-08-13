import { describe, expect, it } from 'vitest';
import { MAX_WIND } from './wind';
import { windFlagRotationRad } from './wind-flag';

const NEUTRAL_RAD = Math.PI / 2;

describe('windFlagRotationRad — направление и сила (issue #550)', () => {
    it('wind = 0 → флажок в нейтрали (виснет вдоль мачты)', () => {
        expect(windFlagRotationRad(0)).toBeCloseTo(NEUTRAL_RAD);
    });

    it('положительный ветер (вправо) уводит угол ниже нейтрали (наклон к горизонтали)', () => {
        expect(windFlagRotationRad(MAX_WIND)).toBeLessThan(NEUTRAL_RAD);
    });

    it('отрицательный ветер (влево) уводит угол выше нейтрали', () => {
        expect(windFlagRotationRad(-MAX_WIND)).toBeGreaterThan(NEUTRAL_RAD);
    });

    it('знак наклона зеркален относительно знака ветра при равной силе', () => {
        const right = windFlagRotationRad(MAX_WIND * 0.5);
        const left = windFlagRotationRad(-MAX_WIND * 0.5);
        expect(NEUTRAL_RAD - right).toBeCloseTo(left - NEUTRAL_RAD);
    });

    it('три различимых положения на сторону (магнитуда 1..3)', () => {
        const angles = [1 / 3, 2 / 3, 1].map((ratio) => windFlagRotationRad(MAX_WIND * ratio));
        const distinct = new Set(angles.map((a) => Math.round(a * 1000)));
        expect(distinct.size).toBe(3);
    });

    it('монотонность: больший модуль ветра — сильнее наклон от нейтрали', () => {
        const weak = windFlagRotationRad(MAX_WIND * (1 / 3));
        const medium = windFlagRotationRad(MAX_WIND * (2 / 3));
        const strong = windFlagRotationRad(MAX_WIND);
        const leanOf = (rad: number) => Math.abs(NEUTRAL_RAD - rad);
        expect(leanOf(weak)).toBeLessThan(leanOf(medium));
        expect(leanOf(medium)).toBeLessThanOrEqual(leanOf(strong));
    });

    it('деление на ноль в windMagnitude (maxWind = 0) не роняет расчёт — остаётся нейтраль', () => {
        expect(windFlagRotationRad(MAX_WIND, 0)).toBeCloseTo(NEUTRAL_RAD);
    });
});
