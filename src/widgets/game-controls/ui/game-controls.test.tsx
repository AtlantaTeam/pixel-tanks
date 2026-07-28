import { render } from '@testing-library/react';
import { GameControls } from './game-controls';

describe('GameControls', () => {
    it('renders the mute toggle as an <Icon>, not an emoji glyph', () => {
        const { getByRole, container } = render(<GameControls />);

        const muteButton = getByRole('button', { name: 'Выключить звук' });
        expect(muteButton.querySelector('svg')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    });

    it('renders every counter button as a 44px touch target', () => {
        const { getByRole, getAllByRole } = render(<GameControls />);

        // Триггер Select — не квадратная icon-кнопка, а полноширинный дропдаун:
        // у него свой размерный класс (min-h-11), проверяемый отдельным тестом ниже.
        const weaponTrigger = getByRole('button', { name: 'Оружие' });
        const buttons = getAllByRole('button').filter((button) => button !== weaponTrigger);
        expect(buttons.length).toBeGreaterThan(0);
        for (const button of buttons) {
            expect(button).toHaveClass('size-11');
        }
    });

    it('renders the weapon select trigger as a 44px touch target', () => {
        const { getByRole } = render(<GameControls />);

        expect(getByRole('button', { name: 'Оружие' })).toHaveClass('min-h-11');
    });
});
