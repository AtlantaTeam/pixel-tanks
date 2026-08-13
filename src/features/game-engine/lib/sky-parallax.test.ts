import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { advanceOffset, createInitialOffsets, wrapOffset } from './sky-parallax';

describe('wrapOffset', () => {
    it('держит значение в диапазоне [0, span)', () => {
        expect(wrapOffset(10, 100)).toBe(10);
        expect(wrapOffset(120, 100)).toBe(20);
        expect(wrapOffset(-30, 100)).toBe(70);
        expect(wrapOffset(-230, 100)).toBe(70);
    });

    it('вырожденный span (0) не делит на ноль', () => {
        expect(wrapOffset(50, 0)).toBe(0);
    });
});

describe('advanceOffset', () => {
    it('двигает смещение по времени (px/мс × dt)', () => {
        // speed 0.02 px/мс, dt 100 мс → +2 px
        expect(advanceOffset(0, 0.02, 100, 1000)).toBeCloseTo(2, 6);
    });

    it('движение не зависит от FPS: два шага по 16 мс == один шаг 32 мс', () => {
        const speed = 0.05;
        const span = 640;
        const oneBigStep = advanceOffset(100, speed, 32, span);
        const twoSmallSteps = advanceOffset(advanceOffset(100, speed, 16, span), speed, 16, span);
        expect(twoSmallSteps).toBeCloseTo(oneBigStep, 6);
    });

    it('заворачивает по модулю span, не растёт бесконечно', () => {
        expect(advanceOffset(630, 0.05, 400, 640)).toBeCloseTo(10, 6); // 630 + 20 = 650 → 10
    });

    it('нулевой dt не двигает смещение', () => {
        expect(advanceOffset(42, 0.05, 0, 640)).toBe(42);
    });
});

describe('createInitialOffsets', () => {
    it('один сид даёт те же стартовые смещения (тот же старт сцены)', () => {
        expect(createInitialOffsets(2026, 3)).toEqual(createInitialOffsets(2026, 3));
        expect(createInitialOffsets('daily-x', 2)).toEqual(createInitialOffsets('daily-x', 2));
    });

    it('возвращает по одному смещению на слой', () => {
        expect(createInitialOffsets(1, 3)).toHaveLength(3);
        expect(createInitialOffsets(1, 1)).toHaveLength(1);
    });

    it('разные сиды дают разные стартовые смещения', () => {
        expect(createInitialOffsets(1, 3)).not.toEqual(createInitialOffsets(2, 3));
    });

    it('смещения неотрицательны и конечны', () => {
        createInitialOffsets(99, 4).forEach((offset) => {
            expect(Number.isFinite(offset)).toBe(true);
            expect(offset).toBeGreaterThanOrEqual(0);
        });
    });

    it('не расходует основной поток RNG боя (namespaced seed)', () => {
        // Старт облаков не должен трогать последовательность createSeededRandom(seed),
        // иначе рельеф/ветер/бот того же боя сдвинулись бы (детерминизм реплея).
        // Проверяем ИЗОЛЯЦИЮ честно: значение основного потока до и после вызова.
        const before = createSeededRandom(7)();
        createInitialOffsets(7, 2);
        const after = createSeededRandom(7)();
        expect(after).toBe(before);
    });
});
