import { act, fireEvent, render, within } from '@testing-library/react';
import { useGameStore } from '@/features/game-engine';
import { GamePage } from './game-page';

describe('GamePage', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('ставит data-faction="enemy" на корень на ходе бота (handoff «Ход бота»)', () => {
        // GameCanvas.startGame() на монтировании сбрасывает turn/phase — задаём
        // ПОСЛЕ рендера, иначе mount-эффект тут же перезапишет их обратно.
        const { container } = render(<GamePage seed="42" />);
        act(() => {
            useGameStore.setState({ turn: 'enemy', phase: 'aiming' });
        });

        expect(container.querySelector('main')).toHaveAttribute('data-faction', 'enemy');
    });

    it('не ставит data-faction на ходе игрока', () => {
        useGameStore.setState({ turn: 'player', phase: 'aiming' });
        const { container } = render(<GamePage seed="42" />);

        expect(container.querySelector('main')).not.toHaveAttribute('data-faction');
    });

    it('снимает data-faction после конца боя, даже если ход был за ботом', () => {
        const { container } = render(<GamePage seed="42" />);
        act(() => {
            useGameStore.setState({ turn: 'enemy', phase: 'over' });
        });

        expect(container.querySelector('main')).not.toHaveAttribute('data-faction');
    });

    it('uses dvh viewport height and clips overflow to avoid horizontal scroll', () => {
        const { container } = render(<GamePage seed="42" />);
        const main = container.querySelector('main');

        expect(main).toHaveClass('h-dvh');
        expect(main).toHaveClass('overflow-hidden');
    });

    it('applies safe-area insets so HUD is not covered by system UI', () => {
        const { container } = render(<GamePage seed="42" />);
        const main = container.querySelector('main');

        expect(main).toHaveClass('safe-area-inset');
    });

    // Ссылка на витрину переехала в паузу (handoff «Что делать в кодовой
    // базе»): плавающая иконка поверх арены перекрывала верхний HUD (#423).
    describe('ссылка на витрину компонентов (в паузе)', () => {
        function openPause() {
            const { getByTestId, getAllByRole } = render(<GamePage seed="42" />);
            fireEvent.click(
                within(getByTestId('top-hud-mobile')).getByRole('button', { name: 'Пауза' }),
            );
            return { getAllByRole };
        }

        it('открывается кнопкой паузы верхнего HUD и ведёт на /design-system', () => {
            const { getAllByRole } = openPause();
            const link = getAllByRole('link', { name: /витрина|showcase/i })[0];

            expect(link).toBeInTheDocument();
            expect(link).toHaveAttribute('href', '/design-system');
        });

        it('имеет доступное имя', () => {
            const { getAllByRole } = openPause();
            const link = getAllByRole('link', { name: /витрина|showcase/i })[0];

            expect(link).toHaveAccessibleName(/витрина|showcase/i);
        });
    });
});
