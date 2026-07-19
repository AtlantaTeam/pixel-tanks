import { render } from '@testing-library/react';
import { encodeReplay } from '@/entities/replays';
import { ReplayPage } from './replay-page';

const VALID_CODE = encodeReplay({
    seed: 42,
    moves: [{ kind: 'fire', angle: -0.75, power: 12 }],
});

describe('ReplayPage', () => {
    it('renders the battle canvas for a valid replay code', () => {
        const { container } = render(<ReplayPage code={VALID_CODE} />);

        expect(container.querySelector('canvas')).not.toBeNull();
    });

    it('uses dvh viewport height and clips overflow like the game page', () => {
        const { container } = render(<ReplayPage code={VALID_CODE} />);
        const main = container.querySelector('main');

        expect(main).toHaveClass('h-dvh');
        expect(main).toHaveClass('overflow-hidden');
        expect(main).toHaveClass('safe-area-inset');
    });

    it('shows an error state with a link to the game for an invalid code', () => {
        const { container, getByText, getByRole } = render(<ReplayPage code="***мусор***" />);

        expect(container.querySelector('canvas')).toBeNull();
        expect(getByText('Реплей не найден')).toBeInTheDocument();
        expect(getByRole('link', { name: 'Сыграть самому' })).toHaveAttribute('href', '/game');
    });
});
