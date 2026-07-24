import { describe, expect, it } from 'vitest';
import { clampPower, POWER_MAX, POWER_MIN } from './power';

describe('clampPower', () => {
    it('пропускает значения внутри диапазона без изменений', () => {
        expect(clampPower(10)).toBe(10);
        expect(clampPower(POWER_MIN)).toBe(POWER_MIN);
        expect(clampPower(POWER_MAX)).toBe(POWER_MAX);
    });

    it('обрезает значение выше верхнего предела до POWER_MAX', () => {
        expect(clampPower(POWER_MAX + 1)).toBe(POWER_MAX);
        expect(clampPower(999)).toBe(POWER_MAX);
    });

    it('поднимает значение ниже нижнего предела до POWER_MIN', () => {
        expect(clampPower(POWER_MIN - 1)).toBe(POWER_MIN);
        expect(clampPower(-42)).toBe(POWER_MIN);
    });
});
