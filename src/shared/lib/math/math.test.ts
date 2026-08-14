import { describe, expect, it } from 'vitest';
import { clamp, lerp } from './math';

describe('lerp', () => {
    it('возвращает a при t=0 и b при t=1', () => {
        expect(lerp(10, 20, 0)).toBe(10);
        expect(lerp(10, 20, 1)).toBe(20);
    });

    it('интерполирует середину при t=0.5', () => {
        expect(lerp(10, 20, 0.5)).toBe(15);
    });

    it('экстраполирует за пределами [0,1]', () => {
        expect(lerp(0, 10, 2)).toBe(20);
        expect(lerp(0, 10, -1)).toBe(-10);
    });

    it('работает с убывающим диапазоном (a > b)', () => {
        expect(lerp(20, 10, 0.5)).toBe(15);
    });
});

describe('clamp', () => {
    it('возвращает значение внутри диапазона без изменений', () => {
        expect(clamp(5, 0, 10)).toBe(5);
    });

    it('прижимает к нижней границе', () => {
        expect(clamp(-3, 0, 10)).toBe(0);
    });

    it('прижимает к верхней границе', () => {
        expect(clamp(42, 0, 10)).toBe(10);
    });

    it('возвращает границу на самих краях диапазона', () => {
        expect(clamp(0, 0, 10)).toBe(0);
        expect(clamp(10, 0, 10)).toBe(10);
    });
});
