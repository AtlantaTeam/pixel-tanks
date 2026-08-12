import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHoldRepeat } from './use-hold-repeat';

const pointerDown = (button = 0) => ({ button }) as React.PointerEvent;

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useHoldRepeat', () => {
    it('не вызывает действие сам по себе до истечения задержки (первый шаг — за onClick)', () => {
        const action = vi.fn();
        const { result } = renderHook(() =>
            useHoldRepeat(action, { initialDelayMs: 300, intervalMs: 100 }),
        );

        result.current.onPointerDown(pointerDown());
        expect(action).not.toHaveBeenCalled();

        vi.advanceTimersByTime(299);
        expect(action).not.toHaveBeenCalled();
    });

    it('повторяет действие с интервалом, пока кнопку держат', () => {
        const action = vi.fn();
        const { result } = renderHook(() =>
            useHoldRepeat(action, { initialDelayMs: 300, intervalMs: 100 }),
        );

        result.current.onPointerDown(pointerDown());
        vi.advanceTimersByTime(300 + 100 * 3);

        expect(action).toHaveBeenCalledTimes(3);
    });

    it('прекращает повтор после отпускания кнопки', () => {
        const action = vi.fn();
        const { result } = renderHook(() =>
            useHoldRepeat(action, { initialDelayMs: 300, intervalMs: 100 }),
        );

        result.current.onPointerDown(pointerDown());
        vi.advanceTimersByTime(300 + 100);
        expect(action).toHaveBeenCalledTimes(1);

        result.current.onPointerUp();
        vi.advanceTimersByTime(1000);
        expect(action).toHaveBeenCalledTimes(1);
    });

    it('прекращает повтор при уходе указателя с кнопки', () => {
        const action = vi.fn();
        const { result } = renderHook(() =>
            useHoldRepeat(action, { initialDelayMs: 300, intervalMs: 100 }),
        );

        result.current.onPointerDown(pointerDown());
        vi.advanceTimersByTime(300);
        result.current.onPointerLeave();
        vi.advanceTimersByTime(1000);

        expect(action).not.toHaveBeenCalled();
    });

    it('игнорирует не основную кнопку мыши', () => {
        const action = vi.fn();
        const { result } = renderHook(() =>
            useHoldRepeat(action, { initialDelayMs: 300, intervalMs: 100 }),
        );

        result.current.onPointerDown(pointerDown(2));
        vi.advanceTimersByTime(1000);

        expect(action).not.toHaveBeenCalled();
    });

    it('onClick клавиатуры/тапа без удержания делает ровно один шаг', () => {
        const action = vi.fn();
        const { result } = renderHook(() =>
            useHoldRepeat(action, { initialDelayMs: 300, intervalMs: 100 }),
        );

        // Клавиатура шлёт click без pointer-событий — шаг проходит.
        result.current.onClick();
        expect(action).toHaveBeenCalledTimes(1);
    });

    it('быстрый тап: pointerdown → pointerup → click даёт один шаг', () => {
        const action = vi.fn();
        const { result } = renderHook(() =>
            useHoldRepeat(action, { initialDelayMs: 300, intervalMs: 100 }),
        );

        result.current.onPointerDown(pointerDown());
        vi.advanceTimersByTime(50); // меньше initialDelay — повтор не стартовал
        result.current.onPointerUp();
        result.current.onClick();

        expect(action).toHaveBeenCalledTimes(1);
    });

    it('после авто-повтора хвостовой onClick глотается (нет лишнего шага)', () => {
        const action = vi.fn();
        const { result } = renderHook(() =>
            useHoldRepeat(action, { initialDelayMs: 300, intervalMs: 100 }),
        );

        result.current.onPointerDown(pointerDown());
        vi.advanceTimersByTime(300 + 100 * 3); // 3 тика повтора
        result.current.onPointerUp();
        result.current.onClick(); // хвостовой клик на отпускании

        expect(action).toHaveBeenCalledTimes(3);
    });

    it('снимает таймеры при размонтировании', () => {
        const action = vi.fn();
        const { result, unmount } = renderHook(() =>
            useHoldRepeat(action, { initialDelayMs: 300, intervalMs: 100 }),
        );

        result.current.onPointerDown(pointerDown());
        unmount();
        vi.advanceTimersByTime(1000);

        expect(action).not.toHaveBeenCalled();
    });
});
