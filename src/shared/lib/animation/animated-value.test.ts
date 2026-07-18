import { describe, expect, it } from 'vitest';
import { AnimatedValue } from './animated-value';

describe('AnimatedValue: плавный переход числа к цели', () => {
    it('изначально равно initial и неактивно', () => {
        const value = new AnimatedValue(10);

        expect(value.current).toBe(10);
        expect(value.isActive()).toBe(false);
    });

    it('setTarget с тем же значением не запускает переход', () => {
        const value = new AnimatedValue(5);

        value.setTarget(5);

        expect(value.isActive()).toBe(false);
    });

    it('setTarget запускает переход от текущего отображаемого значения', () => {
        const value = new AnimatedValue(0, { durationMs: 100 });

        value.setTarget(10);

        expect(value.isActive()).toBe(true);
        expect(value.current).toBe(0);
    });

    it('update продвигает значение к цели пропорционально прогрессу (ease-out)', () => {
        const value = new AnimatedValue(0, { durationMs: 100 });
        value.setTarget(10);

        const mid = value.update(50);

        // easeOutQuad(0.5) = 0.75 → 0 + 10*0.75 = 7.5
        expect(mid).toBeCloseTo(7.5);
        expect(value.isActive()).toBe(true);
    });

    it('update ровно на durationMs завершает переход точным целевым значением', () => {
        const value = new AnimatedValue(0, { durationMs: 100 });
        value.setTarget(10);

        const result = value.update(100);

        expect(result).toBe(10);
        expect(value.isActive()).toBe(false);
    });

    it('update, превышающий durationMs, не перескакивает цель и клампится к ней', () => {
        const value = new AnimatedValue(0, { durationMs: 100 });
        value.setTarget(10);

        value.update(60);
        const result = value.update(1000);

        expect(result).toBe(10);
        expect(value.isActive()).toBe(false);
    });

    it('повторный setTarget посреди перехода стартует от текущей промежуточной точки', () => {
        const value = new AnimatedValue(0, { durationMs: 100 });
        value.setTarget(10);
        value.update(50); // current = 7.5

        value.setTarget(20);
        const result = value.update(0);

        expect(result).toBeCloseTo(7.5);
        expect(value.isActive()).toBe(true);
    });

    it('работает на убывание (например, ходы -1)', () => {
        const value = new AnimatedValue(4, { durationMs: 100 });

        value.setTarget(3);
        const result = value.update(100);

        expect(result).toBe(3);
    });

    it('update без активного перехода возвращает current без изменений', () => {
        const value = new AnimatedValue(7);

        const result = value.update(16);

        expect(result).toBe(7);
    });
});
