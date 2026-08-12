import { describe, expect, it } from 'vitest';
import {
    computeWorldScale,
    WORLD_SCALE_MAX,
    WORLD_SCALE_MIN,
    WORLD_SCALE_REFERENCE_WIDTH,
    WORLD_UNITS,
} from './world-scale';

/** Канонные вьюпорты трека мобильной эргономики. */
const VIEWPORTS = { mobile: 390, tablet: 768, desktop: 1280, wide: 1920 } as const;

describe('computeWorldScale — коэффициент масштаба мира от ширины арены', () => {
    it('на опорной ширине даёт ровно 1 (объекты в каноне прежних констант)', () => {
        expect(computeWorldScale(WORLD_SCALE_REFERENCE_WIDTH)).toBe(1);
    });

    it('в середине диапазона линеен: scale = width / REFERENCE', () => {
        expect(computeWorldScale(768)).toBeCloseTo(0.768, 5);
        expect(computeWorldScale(1280)).toBeCloseTo(1.28, 5);
    });

    it('узкий экран (390) зажат снизу нижней границей', () => {
        // 390 / 1000 = 0.39 < MIN → клампится до MIN.
        expect(computeWorldScale(VIEWPORTS.mobile)).toBe(WORLD_SCALE_MIN);
    });

    it('широкий экран (1920) зажат сверху верхней границей', () => {
        // 1920 / 1000 = 1.92 > MAX → клампится до MAX.
        expect(computeWorldScale(VIEWPORTS.wide)).toBe(WORLD_SCALE_MAX);
    });

    it('канонные вьюпорты дают ожидаемый коэффициент', () => {
        expect(computeWorldScale(VIEWPORTS.mobile)).toBe(0.5);
        expect(computeWorldScale(VIEWPORTS.tablet)).toBeCloseTo(0.768, 5);
        expect(computeWorldScale(VIEWPORTS.desktop)).toBeCloseTo(1.28, 5);
        expect(computeWorldScale(VIEWPORTS.wide)).toBe(1.5);
    });

    describe('границы клампа', () => {
        it('ширина ниже точки насыщения снизу упирается в MIN', () => {
            // MIN достигается при width ≤ REFERENCE * MIN = 500.
            const floorWidth = WORLD_SCALE_REFERENCE_WIDTH * WORLD_SCALE_MIN;
            expect(computeWorldScale(floorWidth)).toBe(WORLD_SCALE_MIN);
            expect(computeWorldScale(floorWidth - 100)).toBe(WORLD_SCALE_MIN);
        });

        it('чуть выше точки насыщения снизу коэффициент уже растёт', () => {
            const floorWidth = WORLD_SCALE_REFERENCE_WIDTH * WORLD_SCALE_MIN;
            expect(computeWorldScale(floorWidth + 1)).toBeGreaterThan(WORLD_SCALE_MIN);
        });

        it('ширина выше точки насыщения сверху упирается в MAX', () => {
            // MAX достигается при width ≥ REFERENCE * MAX = 1500.
            const capWidth = WORLD_SCALE_REFERENCE_WIDTH * WORLD_SCALE_MAX;
            expect(computeWorldScale(capWidth)).toBe(WORLD_SCALE_MAX);
            expect(computeWorldScale(capWidth + 500)).toBe(WORLD_SCALE_MAX);
        });

        it('чуть ниже точки насыщения сверху коэффициент ещё меньше MAX', () => {
            const capWidth = WORLD_SCALE_REFERENCE_WIDTH * WORLD_SCALE_MAX;
            expect(computeWorldScale(capWidth - 1)).toBeLessThan(WORLD_SCALE_MAX);
        });
    });

    describe('битый вход → нижняя граница (fail-safe)', () => {
        it.each([0, -100, NaN, Infinity, -Infinity])('%p → MIN', (value) => {
            expect(computeWorldScale(value)).toBe(WORLD_SCALE_MIN);
        });
    });

    describe('критерии приёмки #455: пропорция танка', () => {
        it('ширина танка ≤ 10% ширины арены на 390', () => {
            const scale = computeWorldScale(VIEWPORTS.mobile);
            const tankWidth = WORLD_UNITS.tankWidth * scale;
            expect(tankWidth / VIEWPORTS.mobile).toBeLessThanOrEqual(0.1);
        });

        it('ширина танка ≥ 4% ширины арены на 1280', () => {
            const scale = computeWorldScale(VIEWPORTS.desktop);
            const tankWidth = WORLD_UNITS.tankWidth * scale;
            expect(tankWidth / VIEWPORTS.desktop).toBeGreaterThanOrEqual(0.04);
        });

        it('на 1920 танк тоже не мельче 4% (верхний кламп держит пропорцию)', () => {
            const scale = computeWorldScale(VIEWPORTS.wide);
            const tankWidth = WORLD_UNITS.tankWidth * scale;
            expect(tankWidth / VIEWPORTS.wide).toBeGreaterThanOrEqual(0.04);
        });
    });
});
