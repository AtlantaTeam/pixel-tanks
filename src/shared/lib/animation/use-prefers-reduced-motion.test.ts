import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

function mockReducedMotion(matches: boolean): () => void {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(
        (query: string) =>
            ({
                matches,
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }) as unknown as MediaQueryList,
    );
    return () => {
        window.matchMedia = original;
    };
}

describe('usePrefersReducedMotion', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns false when the user has no motion preference', () => {
        const restore = mockReducedMotion(false);
        const { result } = renderHook(() => usePrefersReducedMotion());

        expect(result.current).toBe(false);
        restore();
    });

    it('returns true when the user prefers reduced motion', () => {
        const restore = mockReducedMotion(true);
        const { result } = renderHook(() => usePrefersReducedMotion());

        expect(result.current).toBe(true);
        restore();
    });

    it('subscribes to matchMedia change events and unsubscribes on unmount', () => {
        const addEventListener = vi.fn();
        const removeEventListener = vi.fn();
        window.matchMedia = vi.fn(
            (query: string) =>
                ({
                    matches: false,
                    media: query,
                    onchange: null,
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                    addEventListener,
                    removeEventListener,
                    dispatchEvent: vi.fn(),
                }) as unknown as MediaQueryList,
        );

        const { unmount } = renderHook(() => usePrefersReducedMotion());
        expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

        unmount();
        expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });
});
