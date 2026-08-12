import { describe, expect, it } from 'vitest';
import {
    computeArenaZone,
    EMPTY_ARENA_INSETS,
    normalizeInset,
    type TArenaInsets,
} from './arena-insets';

describe('normalizeInset', () => {
    it('пропускает неотрицательное конечное значение как есть', () => {
        expect(normalizeInset(0)).toBe(0);
        expect(normalizeInset(284)).toBe(284);
        expect(normalizeInset(12.5)).toBe(12.5);
    });

    it('приводит отрицательное к нулю', () => {
        expect(normalizeInset(-1)).toBe(0);
        expect(normalizeInset(-9999)).toBe(0);
    });

    it('приводит NaN и бесконечности к нулю', () => {
        expect(normalizeInset(Number.NaN)).toBe(0);
        expect(normalizeInset(Number.POSITIVE_INFINITY)).toBe(0);
        expect(normalizeInset(Number.NEGATIVE_INFINITY)).toBe(0);
    });
});

describe('computeArenaZone', () => {
    it('без инсетов зона равна всему канвасу', () => {
        expect(computeArenaZone(844, EMPTY_ARENA_INSETS)).toEqual({ top: 0, height: 844 });
    });

    it('вычитает верхний и нижний инсеты из высоты канваса', () => {
        const insets: TArenaInsets = { top: 280, bottom: 200 };
        expect(computeArenaZone(844, insets)).toEqual({ top: 280, height: 364 });
    });

    it('пересчитывает зону при ресайзе (та же ориентация, другая высота)', () => {
        const insets: TArenaInsets = { top: 120, bottom: 100 };
        // Окно уменьшилось по высоте — зона обязана пересчитаться под новую высоту.
        expect(computeArenaZone(800, insets)).toEqual({ top: 120, height: 580 });
        expect(computeArenaZone(600, insets)).toEqual({ top: 120, height: 380 });
    });

    it('пересчитывает зону при смене ориентации (portrait ↔ landscape)', () => {
        const insets: TArenaInsets = { top: 120, bottom: 100 };
        // Поворот телефона: высота канваса меняется с 844 (portrait) на 390
        // (landscape) — свободная зона схлопывается пропорционально.
        expect(computeArenaZone(844, insets).height).toBe(624);
        expect(computeArenaZone(390, insets).height).toBe(170);
    });

    it('при нулевых инсетах зона занимает весь канвас', () => {
        expect(computeArenaZone(500, { top: 0, bottom: 0 })).toEqual({ top: 0, height: 500 });
    });

    it('аномально большие инсеты дают нулевую, а не отрицательную высоту зоны', () => {
        // Перекрытие оверлеев (короткий landscape): сумма инсетов больше высоты.
        const zone = computeArenaZone(844, { top: 600, bottom: 600 });
        expect(zone.height).toBe(0);
        expect(zone.height).toBeGreaterThanOrEqual(0);
    });

    it('один верхний инсет больше высоты канваса зажимается, высота зоны — ноль', () => {
        const zone = computeArenaZone(844, { top: 1000, bottom: 0 });
        expect(zone.top).toBe(844);
        expect(zone.height).toBe(0);
    });

    it('битые инсеты (NaN/Infinity/отрицательные) не роняют зону в NaN/минус', () => {
        const zone = computeArenaZone(844, {
            top: Number.NaN,
            bottom: Number.NEGATIVE_INFINITY,
        });
        expect(zone).toEqual({ top: 0, height: 844 });
    });

    it('нулевая или отрицательная высота канваса даёт пустую зону', () => {
        expect(computeArenaZone(0, { top: 50, bottom: 50 })).toEqual({ top: 0, height: 0 });
        expect(computeArenaZone(-100, EMPTY_ARENA_INSETS)).toEqual({ top: 0, height: 0 });
    });
});
