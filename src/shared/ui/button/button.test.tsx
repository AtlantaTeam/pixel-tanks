import { render } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
    it('renders icon size as a 44px touch target', () => {
        const { getByRole } = render(<Button size="icon">+</Button>);

        expect(getByRole('button')).toHaveClass('size-11');
    });

    it('renders default (md) size with min-height 44px touch target', () => {
        const { getByRole } = render(<Button>Новая игра</Button>);

        expect(getByRole('button')).toHaveClass('min-h-11');
    });

    it('renders sm size with min-height 44px touch target', () => {
        const { getByRole } = render(<Button size="sm">OK</Button>);

        expect(getByRole('button')).toHaveClass('min-h-11');
    });

    it('renders primary variant from semantic token classes, not hardcoded colors', () => {
        const { getByRole } = render(<Button variant="primary">Играть</Button>);

        const button = getByRole('button');
        expect(button.className).toMatch(/\bbg-primary\b/);
        expect(button.className).toMatch(/\btext-primary-ink\b/);
        expect(button.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('renders accent variant from theme-runtime CSS vars, so faction theme switches it without a prop', () => {
        const { getByRole } = render(<Button variant="accent">Ход</Button>);

        const button = getByRole('button');
        expect(button.className).toMatch(/var\(--accent\)/);
        expect(button.className).toMatch(/var\(--accent-ink\)/);
        expect(button.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });
});
