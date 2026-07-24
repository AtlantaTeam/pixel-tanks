import { render } from '@testing-library/react';
import { Panel } from './panel';

describe('Panel', () => {
    it('renders from semantic token classes, not hardcoded colors', () => {
        const { container } = render(<Panel>Содержимое</Panel>);

        const panel = container.firstElementChild as HTMLElement;
        expect(panel.className).toMatch(/\bbg-panel\b/);
        expect(panel.className).toMatch(/\btext-text\b/);
        expect(panel.className).toMatch(/var\(--shadow-panel\)/);
        expect(panel.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('merges a caller className with its own base classes', () => {
        const { container } = render(<Panel className="w-full max-w-md">Содержимое</Panel>);

        const panel = container.firstElementChild as HTMLElement;
        expect(panel.className).toMatch(/\bw-full\b/);
        expect(panel.className).toMatch(/\bmax-w-md\b/);
        expect(panel.className).toMatch(/\bbg-panel\b/);
    });
});
