import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnimatedValue } from './use-animated-value';

describe('useAnimatedValue: HUD-число без мгновенного скачка', () => {
    let rafCallbacks: FrameRequestCallback[] = [];
    let now = 1000;

    beforeEach(() => {
        rafCallbacks = [];
        now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const flushFrame = (dt: number) => {
        now += dt;
        const callbacks = rafCallbacks;
        rafCallbacks = [];
        act(() => {
            callbacks.forEach((cb) => cb(now));
        });
    };

    it('без смены target отдаёт исходное значение и не запускает rAF', () => {
        const { result } = renderHook(() => useAnimatedValue(5));

        expect(result.current).toBe(5);
        expect(rafCallbacks).toHaveLength(0);
    });

    it('при смене target не скачет мгновенно — тянется через промежуточные кадры', () => {
        const { result, rerender } = renderHook(
            ({ target }) => useAnimatedValue(target, { durationMs: 100 }),
            { initialProps: { target: 0 } },
        );

        rerender({ target: 10 });
        expect(result.current).toBe(0); // не скакнуло сразу

        flushFrame(50);
        expect(result.current).toBeGreaterThan(0);
        expect(result.current).toBeLessThan(10);

        flushFrame(100);
        expect(result.current).toBe(10);
    });

    it('работает на убывание значения (ходы -1)', () => {
        const { result, rerender } = renderHook(
            ({ target }) => useAnimatedValue(target, { durationMs: 100 }),
            { initialProps: { target: 4 } },
        );

        rerender({ target: 3 });
        flushFrame(100);

        expect(result.current).toBe(3);
    });
});
