import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitDailyScore } from '@/features/daily-challenge';
import { useGameStore } from '@/features/game-engine';
import { GameOverDialog } from './game-over-dialog';

vi.mock('@/features/daily-challenge', async () => {
    const actual = await vi.importActual<typeof import('@/features/daily-challenge')>(
        '@/features/daily-challenge',
    );
    return { ...actual, submitDailyScore: vi.fn().mockResolvedValue(undefined) };
});

const submitMock = vi.mocked(submitDailyScore);

function setGameOver(playerPoints: number, enemyPoints: number) {
    useGameStore.setState({ isGameOver: true, playerPoints, enemyPoints });
}

describe('GameOverDialog', () => {
    beforeEach(() => {
        submitMock.mockClear();
        window.sessionStorage.clear();
        useGameStore.setState({
            isGameOver: false,
            playerPoints: 0,
            enemyPoints: 0,
            battleSeed: null,
            battleField: null,
            replayMoves: [],
        });
    });

    it('shows the score when the game is over', () => {
        setGameOver(10, 5);
        render(<GameOverDialog seed="42" />);

        expect(screen.getByText(/10.*5/)).toBeInTheDocument();
    });

    it('does not show a share button for a regular (non-daily) seed', () => {
        setGameOver(10, 5);
        render(<GameOverDialog seed="42" />);

        expect(screen.queryByRole('button', { name: /Поделиться/i })).not.toBeInTheDocument();
    });

    it('does not show a share button when there is no seed at all', () => {
        setGameOver(10, 5);
        render(<GameOverDialog />);

        expect(screen.queryByRole('button', { name: /Поделиться/i })).not.toBeInTheDocument();
    });

    it('shows a share invitation after a daily-challenge battle', () => {
        setGameOver(10, 5);
        render(<GameOverDialog seed="daily-2026-07-19" />);

        expect(screen.getByRole('button', { name: /Поделиться/i })).toBeInTheDocument();
    });

    it('submits the daily score exactly once for a daily seed', () => {
        setGameOver(30, 10);
        render(<GameOverDialog seed="daily-2026-07-19" />);

        expect(submitMock).toHaveBeenCalledTimes(1);
        expect(submitMock).toHaveBeenCalledWith({
            seed: 'daily-2026-07-19',
            points: 30,
            opponent: 'Terminator',
        });
    });

    it('clamps negative player points to zero before submitting', () => {
        setGameOver(-7, 10);
        render(<GameOverDialog seed="daily-2026-07-19" />);

        expect(submitMock).toHaveBeenCalledWith(
            expect.objectContaining({ seed: 'daily-2026-07-19', points: 0 }),
        );
    });

    it('does not submit for a regular (non-daily) seed', () => {
        setGameOver(30, 10);
        render(<GameOverDialog seed="42" />);

        expect(submitMock).not.toHaveBeenCalled();
    });

    it('does not submit when there is no seed', () => {
        setGameOver(30, 10);
        render(<GameOverDialog />);

        expect(submitMock).not.toHaveBeenCalled();
    });

    it('shows a "Поделиться боем" replay-share button when a battle seed was recorded', () => {
        setGameOver(10, 5);
        useGameStore.setState({
            battleSeed: 42,
            battleField: { width: 800, height: 600 },
            replayMoves: [],
        });
        render(<GameOverDialog seed="42" />);

        expect(screen.getByRole('button', { name: /Поделиться боем/i })).toBeInTheDocument();
    });

    it('does not show a replay-share button when no battle seed was recorded', () => {
        setGameOver(10, 5);
        useGameStore.setState({ battleSeed: null, battleField: null, replayMoves: [] });
        render(<GameOverDialog seed="42" />);

        expect(screen.queryByRole('button', { name: /Поделиться боем/i })).not.toBeInTheDocument();
    });

    it('does not submit again for the same seed across a remount (reload guard)', async () => {
        setGameOver(30, 10);
        const { unmount } = render(<GameOverDialog seed="daily-2026-07-19" />);

        // Ждём, пока успешная отправка пометит seed в sessionStorage.
        await waitFor(() =>
            expect(
                window.sessionStorage.getItem('daily-submitted:daily-2026-07-19'),
            ).not.toBeNull(),
        );
        unmount();

        render(<GameOverDialog seed="daily-2026-07-19" />);

        expect(submitMock).toHaveBeenCalledTimes(1);
    });
});
