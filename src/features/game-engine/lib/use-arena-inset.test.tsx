import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useGameStore } from '../model/game.store';
import { useArenaInset } from './use-arena-inset';
import type { TArenaInsets } from './arena-insets';

// Захватываем колбэк ResizeObserver, чтобы вручную имитировать изменение высоты
// оверлея (happy-dom не пересчитывает layout сам).
let observerCallback: (() => void) | null = null;
const disconnect = vi.fn();

class MockResizeObserver {
    constructor(cb: () => void) {
        observerCallback = cb;
    }
    observe() {}
    unobserve() {}
    disconnect = disconnect;
}

// Высота, которую вернёт getBoundingClientRect любого узла в тесте (happy-dom сам
// отдаёт 0). Меняем её, чтобы имитировать разные высоты оверлея.
let measuredHeight = 0;

function Probe({ edge }: { edge: keyof TArenaInsets }) {
    const ref = useArenaInset<HTMLDivElement>(edge);
    return <div ref={ref} />;
}

describe('useArenaInset — публикация высоты оверлея в инсеты арены (#453)', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        observerCallback = null;
        measuredHeight = 0;
        disconnect.mockClear();
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
            () => ({ height: measuredHeight }) as DOMRect,
        );
        useGameStore.getState().setArenaInset('top', 0);
        useGameStore.getState().setArenaInset('bottom', 0);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('публикует замеренную высоту в свою грань инсета при монтировании', () => {
        measuredHeight = 284;
        render(<Probe edge="top" />);

        expect(useGameStore.getState().arenaInsets.top).toBe(284);
        expect(useGameStore.getState().arenaInsets.bottom).toBe(0);
    });

    it('обновляет инсет, когда ResizeObserver сообщает новую высоту', () => {
        measuredHeight = 150;
        render(<Probe edge="bottom" />);
        expect(useGameStore.getState().arenaInsets.bottom).toBe(150);

        // Палуба выросла (подсказка жеста) — новый замер, ResizeObserver дёргает колбэк.
        measuredHeight = 175;
        observerCallback?.();

        expect(useGameStore.getState().arenaInsets.bottom).toBe(175);
    });

    it('обнуляет свою грань при размонтировании (стор-синглтон не держит прошлое)', () => {
        measuredHeight = 284;
        const { unmount } = render(<Probe edge="top" />);
        expect(useGameStore.getState().arenaInsets.top).toBe(284);

        unmount();

        expect(disconnect).toHaveBeenCalled();
        expect(useGameStore.getState().arenaInsets.top).toBe(0);
    });
});
