import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '@/features/game-engine';
import { GameOverDialog } from './game-over-dialog';

vi.mock('@/features/daily-challenge', async () => {
    const actual = await vi.importActual<typeof import('@/features/daily-challenge')>(
        '@/features/daily-challenge',
    );
    return { ...actual, submitDailyScore: vi.fn().mockResolvedValue(undefined) };
});

function setGameOver(playerPoints: number, enemyPoints: number) {
    useGameStore.setState({ isGameOver: true, playerPoints, enemyPoints });
}

describe('GameOverDialog', () => {
    beforeEach(() => {
        useGameStore.setState({ isGameOver: false, playerPoints: 0, enemyPoints: 0 });
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
});
