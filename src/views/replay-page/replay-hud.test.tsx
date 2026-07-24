import { act, render, screen } from '@testing-library/react';
import { useGameStore } from '@/features/game-engine';
import { ReplayHud } from './replay-hud';

describe('ReplayHud', () => {
    afterEach(() => {
        useGameStore.getState().resetGame();
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
        render(<ReplayHud />);

        expect(screen.getByText('Бой завершён')).toBeInTheDocument();
        expect(screen.queryByText('Реплей')).not.toBeInTheDocument();
    });
});
