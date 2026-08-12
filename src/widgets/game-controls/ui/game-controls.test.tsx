import { render } from '@testing-library/react';
import { GameControls } from './game-controls';

describe('GameControls', () => {
    it('renders the weapon select trigger as a 44px touch target', () => {
        const { getByRole } = render(<GameControls />);

        expect(getByRole('button', { name: /Оружие/ })).toHaveClass('min-h-11');
    });
});
