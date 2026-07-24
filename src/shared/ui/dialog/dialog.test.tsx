import { render } from '@testing-library/react';
import { Dialog } from './dialog';

describe('Dialog', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<Dialog open={false}>Содержимое</Dialog>);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders the overlay and panel from semantic token classes, not hardcoded colors', () => {
        const { getByRole } = render(<Dialog open>Содержимое</Dialog>);

        const overlay = getByRole('dialog');
        expect(overlay.className).toMatch(/\bbg-bg\/70\b/);
        expect(overlay.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('deepens the panel border/shadow relative to a plain Panel via CSS-var override', () => {
        const { getByRole } = render(<Dialog open>Содержимое</Dialog>);

        const panel = getByRole('dialog').firstElementChild as HTMLElement;
        expect(panel.style.getPropertyValue('--panel-border-color')).toBe(
            'var(--color-border-strong)',
        );
        expect(panel.style.getPropertyValue('--panel-shadow')).toBe('var(--shadow-drop)');
    });
});
