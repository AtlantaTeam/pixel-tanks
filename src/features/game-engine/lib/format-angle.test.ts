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

    // #457: HUD в начале боя показывал «УГОЛ 360°» — ствол игрока стартует
    // строго горизонтально (`gunpointAngle === 0`, см. `GamePlay.start`), а
    // формула читала ноль как полный круг. Показ обязан быть в [0, 360).
    it('ноль радиан — горизонталь, 0° (а не полный круг)', () => {
        expect(formatAngle(0)).toBe(0);
    });

    it('полный оборот в любую сторону сворачивается в 0°', () => {
        expect(formatAngle(2 * Math.PI)).toBe(0);
        expect(formatAngle(-2 * Math.PI)).toBe(0);
    });

    it('не выходит за диапазон [0, 360) на обороте в обе стороны', () => {
        for (let deg = -720; deg <= 720; deg += 1) {
            const shown = formatAngle((deg * Math.PI) / 180);

            expect(shown).toBeGreaterThanOrEqual(0);
            expect(shown).toBeLessThan(360);
        }
    });
});
