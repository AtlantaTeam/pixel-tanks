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

    it('includes a link to design-system page', () => {
        const { getByRole } = render(<GamePage seed="42" />);
        const link = getByRole('link', { name: /витрина|showcase/i });

        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/design-system');
    });

    it('design-system link has accessible aria-label', () => {
        const { getByRole } = render(<GamePage seed="42" />);
        const link = getByRole('link', { name: /витрина|showcase/i });

        expect(link).toHaveAccessibleName(/витрина|showcase/i);
    });

    it('design-system link has minimum touch target size', () => {
        const { getByRole } = render(<GamePage seed="42" />);
        const link = getByRole('link', { name: /витрина|showcase/i });

        expect(link).toHaveClass('min-h-11', 'min-w-11');
    });
});
