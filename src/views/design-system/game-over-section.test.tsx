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

    it('renders all three outcomes as static previews with their battle stats', () => {
        render(<GameOverSection />);

        // Победа {player:30, enemy:10, shots:6, hits:5, maneuvers:3}:
        // урон 90, точность round(5/6)=83 %, манёвров 3 / 4.
        const victory = screen.getByRole('region', { name: /Победа/i });
        expect(within(victory).getByText('Победа!')).toBeInTheDocument();
        expect(within(victory).getByText('Урон')).toBeInTheDocument();
        expect(within(victory).getByText('90')).toBeInTheDocument();
        expect(within(victory).getByText('83 %')).toBeInTheDocument();
        expect(within(victory).getByText('3 / 4')).toBeInTheDocument();

        // Поражение {player:10, enemy:30, shots:7, hits:3}: урон 70, выстрелов 7.
        const defeat = screen.getByRole('region', { name: /Поражение/i });
        expect(within(defeat).getByText('Поражение')).toBeInTheDocument();
        expect(within(defeat).getByText('70')).toBeInTheDocument();
        expect(within(defeat).getByText('7')).toBeInTheDocument();

        // Ничья {player:20, enemy:20, shots:5, hits:3, maneuvers:4}: урон 80, точность 60 %.
        const draw = screen.getByRole('region', { name: /Ничья/i });
        expect(within(draw).getByText('Ничья')).toBeInTheDocument();
        expect(within(draw).getByText('80')).toBeInTheDocument();
        expect(within(draw).getByText('60 %')).toBeInTheDocument();
        expect(within(draw).getByText('4 / 4')).toBeInTheDocument();
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
