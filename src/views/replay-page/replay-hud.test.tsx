import { act, render, screen } from '@testing-library/react';
import { useGameStore } from '@/features/game-engine';
import { ReplayHud } from './replay-hud';

describe('ReplayHud', () => {
    afterEach(() => {
        // resetGame меняет isGameOver в ещё смонтированном компоненте (auto-cleanup RTL
        // отрабатывает позже этого хука) → Zustand перерендерит ReplayHud. Без act(...)
        // vitest печатает «update to ReplayHud was not wrapped in act(...)».
        act(() => {
            useGameStore.getState().resetGame();
        });
    });

    it('показывает бейдж «Реплей» с play-иконкой, а не эмодзи-глифом, пока бой идёт', () => {
        act(() => {
            useGameStore.setState({ isGameOver: false });
        });
        const { container } = render(<ReplayHud />);

        expect(screen.getByText('Реплей')).toBeInTheDocument();
        expect(container.querySelector('svg')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{25A0}-\u{25FF}]/u);
    });

    it('скрывает бейдж «Реплей» и показывает «Бой завершён», когда бой окончен', () => {
        act(() => {
            useGameStore.setState({ isGameOver: true });
        });
        // render в act(...): useAnimatedValue дёргает setState на rAF после монтирования —
        // без обёртки vitest печатает «update to ReplayHud was not wrapped in act(...)».
        act(() => {
            render(<ReplayHud />);
        });

        expect(screen.getByText('Бой завершён')).toBeInTheDocument();
        expect(screen.queryByText('Реплей')).not.toBeInTheDocument();
    });
});
