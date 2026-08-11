import { act, render, screen, waitFor } from '@testing-library/react';
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

function setGameOver(player: number, enemy: number) {
    // Через реальное действие стора (не сырой setState), чтобы сработала
    // фиксация снимка HP на переходе false→true (#337).
    useGameStore.setState({ isGameOver: false, hp: { player, enemy } });
    useGameStore.getState().setGameOver();
}

describe('GameOverDialog', () => {
    beforeEach(() => {
        submitMock.mockClear();
        window.sessionStorage.clear();
        useGameStore.getState().resetGame();
    });

    it('shows the battle stats when the game is over', () => {
        setGameOver(10, 5);
        render(<GameOverDialog seed="42" />);

        // Урон = MAX_HP − enemyHp = 100 − 5 = 95; манёвры из полного бюджета.
        expect(screen.getByText('Урон')).toBeInTheDocument();
        expect(screen.getByText('95')).toBeInTheDocument();
        expect(screen.getByText('Точность')).toBeInTheDocument();
        expect(screen.getByText('Выстрелов')).toBeInTheDocument();
        expect(screen.getByText('0 / 4')).toBeInTheDocument();
    });

    it('switches the theme to victory when the player wins', () => {
        setGameOver(30, 10);
        const { container } = render(<GameOverDialog seed="42" />);

        expect(container.querySelector('[data-outcome="victory"]')).not.toBeNull();
    });

    it('switches the theme to defeat when the player loses', () => {
        setGameOver(5, 20);
        const { container } = render(<GameOverDialog seed="42" />);

        expect(container.querySelector('[data-outcome="defeat"]')).not.toBeNull();
    });

    it('keeps the theme neutral on a draw (no outcome attribute)', () => {
        setGameOver(10, 10);
        const { container } = render(<GameOverDialog seed="42" />);

        expect(container.querySelector('[data-outcome]')).toBeNull();
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

    it('submits the derived leaderboard score once for a daily seed', () => {
        setGameOver(30, 10);
        render(<GameOverDialog seed="daily-2026-07-19" />);

        // Производная метрика (#422): урон 90 + остаток HP 30 + точность 0 = 120,
        // а не сырой остаток HP (30).
        expect(submitMock).toHaveBeenCalledTimes(1);
        expect(submitMock).toHaveBeenCalledWith({
            seed: 'daily-2026-07-19',
            points: 120,
            opponent: 'Terminator',
        });
    });

    it('folds accuracy into the derived score', () => {
        // 3 попадания из 4 выстрелов = точность 75 %.
        useGameStore.setState({ shotsFired: 4, hits: 3 });
        setGameOver(30, 10);
        render(<GameOverDialog seed="daily-2026-07-19" />);

        // урон 90 + остаток HP 30 + точность 75 = 195.
        expect(submitMock).toHaveBeenCalledWith(
            expect.objectContaining({ seed: 'daily-2026-07-19', points: 195 }),
        );
    });

    it('submits a non-negative derived score even on a loss with 0 HP', () => {
        // Игрок добит (HP 0): остаток HP 0, но урон противнику ещё даёт очки.
        setGameOver(-7, 10);
        render(<GameOverDialog seed="daily-2026-07-19" />);

        // урон 90 + остаток HP 0 + точность 0 = 90 (никогда не отрицательное).
        expect(submitMock).toHaveBeenCalledWith(
            expect.objectContaining({ seed: 'daily-2026-07-19', points: 90 }),
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

    it('keeps the finished game outcome stable when the store HP still changes (#337)', () => {
        setGameOver(5, 10);
        const { container } = render(<GameOverDialog seed="42" />);

        expect(screen.getByText('Поражение')).toBeInTheDocument();
        expect(container.querySelector('[data-outcome="defeat"]')).not.toBeNull();

        // Кадры последнего попадания «оседают» после того, как isGameOver уже
        // true (root-cause #337) — заголовок и исход зафиксированного попапа
        // не должны на это реагировать.
        act(() => {
            useGameStore.setState({ hp: { player: 10, enemy: 10 } });
        });

        expect(screen.getByText('Поражение')).toBeInTheDocument();
        expect(container.querySelector('[data-outcome="defeat"]')).not.toBeNull();
        expect(screen.queryByText('Ничья')).not.toBeInTheDocument();
    });

    it('shows both "Новая игра" and "В меню" buttons (#338)', () => {
        setGameOver(10, 5);
        render(<GameOverDialog seed="42" />);

        expect(screen.getByRole('button', { name: /Новая игра/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /В меню/i })).toBeInTheDocument();
    });

    it('"В меню" link points to the home page (#338)', () => {
        setGameOver(10, 5);
        render(<GameOverDialog seed="42" />);

        const menuLink = screen.getByRole('link', { name: /В меню/i });
        expect(menuLink).toHaveAttribute('href', '/');
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
