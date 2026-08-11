import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '@/features/game-engine';
import { GameOverSection } from './game-over-section';

describe('GameOverSection', () => {
    beforeEach(() => {
        // Сбрасываем боевой стор к покою: секция не должна от него зависеть,
        // но и не должна ловить хвост чужого теста в том же файле-синглтоне.
        useGameStore.getState().resetGame();
    });

    it('renders all three outcomes as static previews with their scores', () => {
        render(<GameOverSection />);

        const victory = screen.getByRole('region', { name: /Победа/i });
        expect(within(victory).getByText('Победа!')).toBeInTheDocument();
        expect(within(victory).getByText(/30.*10/)).toBeInTheDocument();

        const defeat = screen.getByRole('region', { name: /Поражение/i });
        expect(within(defeat).getByText('Поражение')).toBeInTheDocument();
        expect(within(defeat).getByText(/10.*30/)).toBeInTheDocument();

        const draw = screen.getByRole('region', { name: /Ничья/i });
        expect(within(draw).getByText('Ничья')).toBeInTheDocument();
        expect(within(draw).getByText(/20.*20/)).toBeInTheDocument();
    });

    it('shows each outcome via a static in-flow dialog (no modal focus-trap)', () => {
        render(<GameOverSection />);

        // Статичный срез не заявляет role="dialog"/aria-modal — иначе скринридер
        // объявил бы диалог-в-потоке вне модального контекста.
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not mutate the global game store while rendering (#337)', () => {
        render(<GameOverSection />);

        const state = useGameStore.getState();
        expect(state.isGameOver).toBe(false);
        expect(state.finalHp).toBeNull();
    });
});
