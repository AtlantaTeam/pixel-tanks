import { describe, it, expect } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { CameraShake } from './camera-shake';

describe('CameraShake', () => {
    it('стартует без дрожания', () => {
        const shake = new CameraShake(createSeededRandom(1));
        expect(shake.isActive()).toBe(false);
        expect(shake.offsetX).toBe(0);
        expect(shake.offsetY).toBe(0);
    });

    it('addTrauma активирует дрожание', () => {
        const shake = new CameraShake(createSeededRandom(1));
        shake.addTrauma(0.5);
        expect(shake.isActive()).toBe(true);
    });

    it('клампит травму сверху в 1', () => {
        const shake = new CameraShake(createSeededRandom(1), { maxOffset: 10, decayPerSecond: 0 });
        shake.addTrauma(5);
        // travma=1 → shake=1 → |offset| ≤ maxOffset
        shake.update(0);
        expect(Math.abs(shake.offsetX)).toBeLessThanOrEqual(10);
        expect(Math.abs(shake.offsetY)).toBeLessThanOrEqual(10);
    });

    it('клампит травму снизу в 0', () => {
        const shake = new CameraShake(createSeededRandom(1));
        shake.addTrauma(-5);
        expect(shake.isActive()).toBe(false);
    });

    it('смещение не превышает maxOffset по каждой оси', () => {
        const shake = new CameraShake(createSeededRandom(42), { maxOffset: 8, decayPerSecond: 0 });
        shake.addTrauma(1);
        for (let i = 0; i < 50; i++) {
            shake.update(0);
            expect(Math.abs(shake.offsetX)).toBeLessThanOrEqual(8);
            expect(Math.abs(shake.offsetY)).toBeLessThanOrEqual(8);
        }
    });

    it('травма затухает во времени и дрожание прекращается', () => {
        const shake = new CameraShake(createSeededRandom(1), { decayPerSecond: 2 });
        shake.addTrauma(1);
        // 2 ед/сек → полная травма гаснет примерно за 500 мс; шагаем с запасом
        for (let i = 0; i < 40; i++) {
            shake.update(16);
        }
        expect(shake.isActive()).toBe(false);
        expect(shake.offsetX).toBe(0);
        expect(shake.offsetY).toBe(0);
    });

    it('быстрее затухает при большем decayPerSecond', () => {
        const slow = new CameraShake(createSeededRandom(1), { decayPerSecond: 1 });
        const fast = new CameraShake(createSeededRandom(1), { decayPerSecond: 8 });
        slow.addTrauma(1);
        fast.addTrauma(1);
        for (let i = 0; i < 10; i++) {
            slow.update(16);
            fast.update(16);
        }
        // за одинаковое время быстрый затух сильнее (или совсем)
        expect(fast.isActive()).toBe(false);
        expect(slow.isActive()).toBe(true);
    });

    it('детерминирован при одинаковом seed', () => {
        const a = new CameraShake(createSeededRandom(7), { decayPerSecond: 0 });
        const b = new CameraShake(createSeededRandom(7), { decayPerSecond: 0 });
        a.addTrauma(1);
        b.addTrauma(1);
        for (let i = 0; i < 20; i++) {
            a.update(16);
            b.update(16);
            expect(a.offsetX).toBe(b.offsetX);
            expect(a.offsetY).toBe(b.offsetY);
        }
    });

    it('update без активной травмы держит нулевое смещение', () => {
        const shake = new CameraShake(createSeededRandom(1));
        shake.update(16);
        expect(shake.offsetX).toBe(0);
        expect(shake.offsetY).toBe(0);
        expect(shake.isActive()).toBe(false);
    });

    it('reset гасит дрожание', () => {
        const shake = new CameraShake(createSeededRandom(1), { decayPerSecond: 0 });
        shake.addTrauma(1);
        shake.update(0);
        shake.reset();
        expect(shake.isActive()).toBe(false);
        expect(shake.offsetX).toBe(0);
        expect(shake.offsetY).toBe(0);
    });
});
