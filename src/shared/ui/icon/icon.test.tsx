import { render } from '@testing-library/react';
import { ICON_NAMES, Icon } from './icon';

describe('Icon', () => {
    it('renders on the 16×16 grid from the design inventory, at 24px by default', () => {
        const { container } = render(<Icon name="play" />);

        const svg = container.querySelector('svg');
        expect(svg).toHaveAttribute('viewBox', '0 0 16 16');
        expect(svg).toHaveAttribute('width', '24');
        expect(svg).toHaveAttribute('height', '24');
    });

    it('accepts a custom size', () => {
        const { container } = render(<Icon name="close" size={16} />);

        const svg = container.querySelector('svg');
        expect(svg).toHaveAttribute('width', '16');
        expect(svg).toHaveAttribute('height', '16');
    });

    it('paints strokes and fills with currentColor, so it follows the text color / theme', () => {
        const { container } = render(<Icon name="star" />);

        const svg = container.querySelector('svg');
        expect(svg).toHaveAttribute('stroke', 'currentColor');
        const rect = container.querySelector('rect');
        if (rect) expect(rect).toHaveAttribute('fill', 'currentColor');
    });

    it('is hidden from assistive tech by default (decorative glyph)', () => {
        const { container } = render(<Icon name="fire" />);

        expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    it('exposes an accessible name and drops aria-hidden when aria-label is passed', () => {
        const { container, getByRole } = render(<Icon name="warning" aria-label="Внимание" />);

        const svg = container.querySelector('svg');
        expect(svg).not.toHaveAttribute('aria-hidden');
        expect(getByRole('img', { name: 'Внимание' })).toBeInTheDocument();
    });

    it('merges a caller className with its own attributes', () => {
        const { container } = render(<Icon name="check" className="text-accent" />);

        expect(container.querySelector('svg')).toHaveClass('text-accent');
    });

    it('renders every name from the design inventory icon set (28 names)', () => {
        expect(ICON_NAMES).toHaveLength(28);

        for (const name of ICON_NAMES) {
            const { container, unmount } = render(<Icon name={name} />);
            expect(container.querySelector('svg')?.children.length).toBeGreaterThan(0);
            unmount();
        }
    });

    it('renders a weapon icon by its inventory name (Cyrillic, 1:1 with GDD weapon names)', () => {
        const { container } = render(<Icon name="wpn-фугас" />);

        expect(container.querySelector('svg')).toBeInTheDocument();
    });
});
