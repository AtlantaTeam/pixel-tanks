import { render } from '@testing-library/react';
import { GamePage } from './game-page';

describe('GamePage', () => {
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
});
