import { describe, expect, it } from 'vitest';
import { formatAngle } from './format-angle';

describe('formatAngle', () => {
    it('читает отрицательные радианы напрямую (прицел вверх, -90°)', () => {
        expect(formatAngle(-Math.PI / 2)).toBe(90);
    });

    it('отрицательный полный разворот даёт 180°', () => {
        expect(formatAngle(-Math.PI)).toBe(180);
    });

    it('малый отрицательный угол округляется вниз до целых градусов', () => {
        expect(formatAngle(-0.1)).toBe(5);
    });

    it('положительные радианы читаются как дополнение до полного круга', () => {
        expect(formatAngle(Math.PI * 1.5)).toBe(90);
    });

    it('ноль радиан — полный круг (360°)', () => {
        expect(formatAngle(0)).toBe(360);
    });
});
