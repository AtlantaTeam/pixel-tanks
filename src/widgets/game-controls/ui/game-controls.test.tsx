import { render } from '@testing-library/react';
import { GameControls } from './game-controls';

describe('GameControls', () => {
    it('renders every counter button as a 44px touch target', () => {
        const { getAllByRole } = render(<GameControls />);

        const buttons = getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
        for (const button of buttons) {
            expect(button).toHaveClass('size-11');
        }
    });

    it('renders the weapon select as a 44px touch target', () => {
        const { getByRole } = render(<GameControls />);

        expect(getByRole('combobox')).toHaveClass('min-h-11');
    });
});
