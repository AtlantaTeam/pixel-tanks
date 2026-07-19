import { describe, it, expect } from 'vitest';
import { SlowMotion } from './slow-motion';
import { mockReducedMotion } from './mock-reduced-motion';

describe('SlowMotion', () => {
    it('вне окна масштаб равен 1 и не активно', () => {
        const slow = new SlowMotion();
        expect(slow.isActive()).toBe(false);
        expect(slow.update(16)).toBe(1);
    });

    it('trigger активирует замедление', () => {
        const slow = new SlowMotion();
        slow.trigger();
        expect(slow.isActive()).toBe(true);
    });

    it('на старте окна масштаб близок к factor', () => {
        const slow = new SlowMotion();
        slow.trigger({ factor: 0.3, durationMs: 300 });
        // первый апдейт: progress=0 → scale=factor
        expect(slow.update(0)).toBeCloseTo(0.3, 5);
    });

    it('масштаб плавно растёт к 1 по ходу окна', () => {
        const slow = new SlowMotion();
        slow.trigger({ factor: 0.2, durationMs: 100 });
        const first = slow.update(50);
        const second = slow.update(0);
        expect(second).toBeGreaterThan(first);
        expect(second).toBeLessThanOrEqual(1);
    });

    it('масштаб всегда в диапазоне [factor, 1]', () => {
        const slow = new SlowMotion();
        slow.trigger({ factor: 0.25, durationMs: 200 });
        for (let i = 0; i < 20; i++) {
            const s = slow.update(16);
            expect(s).toBeGreaterThanOrEqual(0.25);
            expect(s).toBeLessThanOrEqual(1);
        }
    });

    it('по истечении окна возвращает 1 и становится неактивным', () => {
        const slow = new SlowMotion();
        slow.trigger({ factor: 0.3, durationMs: 100 });
        slow.update(60);
        slow.update(60); // суммарно > 100 мс
        expect(slow.isActive()).toBe(false);
        expect(slow.update(16)).toBe(1);
    });

    it('trigger перезапускает окно', () => {
        const slow = new SlowMotion();
        slow.trigger({ factor: 0.3, durationMs: 100 });
        slow.update(90);
        slow.trigger({ factor: 0.3, durationMs: 100 });
        expect(slow.isActive()).toBe(true);
        expect(slow.update(0)).toBeCloseTo(0.3, 5);
    });

    it('reset выключает замедление', () => {
        const slow = new SlowMotion();
        slow.trigger();
        slow.reset();
        expect(slow.isActive()).toBe(false);
        expect(slow.update(16)).toBe(1);
    });

    it('клампит factor > 1 до 1 (не ускоряет время)', () => {
        const slow = new SlowMotion();
        slow.trigger({ factor: 3, durationMs: 100 });
        // factor должен схлопнуться в 1 → масштаб на старте окна не больше 1
        expect(slow.update(0)).toBe(1);
    });

    it('клампит factor ≤ 0 до положительного минимума (нет деления на ~0)', () => {
        const slow = new SlowMotion();
        slow.trigger({ factor: 0, durationMs: 100 });
        const scale = slow.update(0);
        expect(scale).toBeGreaterThan(0);
        expect(scale).toBeLessThanOrEqual(1);
    });

    it('при prefers-reduced-motion масштаб всегда 1', () => {
        const restore = mockReducedMotion(true);
        try {
            const slow = new SlowMotion();
            slow.trigger({ factor: 0.3, durationMs: 100 });
            expect(slow.isActive()).toBe(true);
            expect(slow.update(16)).toBe(1);
            expect(slow.update(16)).toBe(1);
        } finally {
            restore();
        }
    });
});
