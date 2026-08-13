import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '@/features/game-engine';
import { WindShiftBanner, WIND_SHIFT_BANNER_DURATION_MS } from './wind-shift-banner';

/**
 * Плашка смены ветра бурей (#547, §7.8): показывается в момент смены и сама гаснет.
 * Критерий #547 — «в HUD видно, что ветер изменился, в момент изменения».
 */
describe('WindShiftBanner (#547)', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('не показывается до смены ветра (nonce = 0)', () => {
        const { queryByRole } = render(<WindShiftBanner />);
        expect(queryByRole('status')).not.toBeInTheDocument();
    });

    it('появляется в момент смены ветра (announceWindShift)', () => {
        const { queryByRole, rerender } = render(<WindShiftBanner />);

        act(() => {
            useGameStore.getState().setWind(-0.008);
            useGameStore.getState().announceWindShift();
        });
        rerender(<WindShiftBanner />);

        const banner = queryByRole('status');
        expect(banner).toBeInTheDocument();
        // Сообщает направление нового ветра (влево, знак минус).
        expect(banner).toHaveTextContent(/ветер/i);
        expect(banner).toHaveTextContent(/влево/i);
    });

    it('показывает направление вправо при положительном ветре', () => {
        const { queryByRole, rerender } = render(<WindShiftBanner />);
        act(() => {
            useGameStore.getState().setWind(0.006);
            useGameStore.getState().announceWindShift();
        });
        rerender(<WindShiftBanner />);

        expect(queryByRole('status')).toHaveTextContent(/вправо/i);
    });

    it('сама гаснет через отведённое время', () => {
        const { queryByRole, rerender } = render(<WindShiftBanner />);
        act(() => {
            useGameStore.getState().announceWindShift();
        });
        rerender(<WindShiftBanner />);
        expect(queryByRole('status')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(WIND_SHIFT_BANNER_DURATION_MS + 1);
        });
        expect(queryByRole('status')).not.toBeInTheDocument();
    });

    it('новый бой (resetGame) убирает плашку', () => {
        const { queryByRole, rerender } = render(<WindShiftBanner />);
        act(() => {
            useGameStore.getState().announceWindShift();
        });
        rerender(<WindShiftBanner />);
        expect(queryByRole('status')).toBeInTheDocument();

        act(() => {
            useGameStore.getState().resetGame();
        });
        rerender(<WindShiftBanner />);
        expect(queryByRole('status')).not.toBeInTheDocument();
    });
});
