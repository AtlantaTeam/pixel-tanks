import { fireEvent, render } from '@testing-library/react';
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

    it('forwards an accessible name to the dialog role element', () => {
        const { getByRole } = render(
            <Dialog open aria-labelledby="title">
                <h2 id="title">Победа</h2>
            </Dialog>,
        );

        expect(getByRole('dialog')).toHaveAttribute('aria-labelledby', 'title');
    });

    it('closes on Escape when onClose is provided', () => {
        const onClose = vi.fn();
        render(
            <Dialog open onClose={onClose}>
                <button type="button">OK</button>
            </Dialog>,
        );

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not throw on Escape when onClose is absent (uncontrolled close)', () => {
        render(
            <Dialog open>
                <button type="button">OK</button>
            </Dialog>,
        );

        expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
    });

    it('moves focus into the dialog on open', () => {
        const { getByRole } = render(
            <Dialog open onClose={() => {}}>
                <button type="button">OK</button>
            </Dialog>,
        );

        expect(document.activeElement).toBe(getByRole('button', { name: 'OK' }));
    });

    describe('variant="static"', () => {
        it('renders in-flow (no fixed viewport overlay classes)', () => {
            const { getByRole } = render(
                <Dialog open variant="static">
                    Содержимое
                </Dialog>,
            );

            const overlay = getByRole('dialog');
            expect(overlay.className).not.toMatch(/\bfixed\b/);
            expect(overlay.className).toMatch(/\brelative\b/);
        });

        it('does not steal focus on mount', () => {
            const activeBefore = document.activeElement;
            render(
                <Dialog open variant="static">
                    <button type="button">OK</button>
                </Dialog>,
            );

            expect(document.activeElement).toBe(activeBefore);
        });

        it('ignores Escape', () => {
            const onClose = vi.fn();
            render(
                <Dialog open variant="static" onClose={onClose}>
                    <button type="button">OK</button>
                </Dialog>,
            );

            fireEvent.keyDown(document, { key: 'Escape' });
            expect(onClose).not.toHaveBeenCalled();
        });

        it('does not close on backdrop click', () => {
            const onClose = vi.fn();
            const { getByRole } = render(
                <Dialog open variant="static" onClose={onClose}>
                    Содержимое
                </Dialog>,
            );

            fireEvent.click(getByRole('dialog'));
            expect(onClose).not.toHaveBeenCalled();
        });
    });
});
