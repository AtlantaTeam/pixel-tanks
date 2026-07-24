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

    it('renders danger variant with its ink pair for contrast, not light body text', () => {
        const { getByRole } = render(<Button variant="danger">Сдаться</Button>);

        const button = getByRole('button');
        expect(button.className).toMatch(/\bbg-danger\b/);
        expect(button.className).toMatch(/\btext-danger-ink\b/);
        // Тело кнопки не красится светлым text-text (даёт ~2.98:1 на #ff4242).
        expect(button.className).not.toMatch(/\btext-text(?![\w-])/);
    });

    it('feeds edge/glow into the pixel-border shadow slots, not a competing shadow utility', () => {
        const { getByRole } = render(<Button variant="primary">Играть</Button>);

        const button = getByRole('button');
        // Единый источник box-shadow — pixel-border; эффекты идут в его слоты.
        expect(button.className).toMatch(/\[--pixel-border-edge:var\(--edge-pixel\)\]/);
        expect(button.className).not.toMatch(/\bshadow-\[/);
    });

    it('renders a keyboard focus ring via the pixel-border ring slot', () => {
        const { getByRole } = render(<Button>Играть</Button>);

        expect(getByRole('button').className).toMatch(
            /focus-visible:\[--pixel-border-ring:var\(--ring-focus\)\]/,
        );
    });

    it('renders disabled state from semantic muted tokens, not opacity', () => {
        const { getByRole } = render(<Button disabled>Недоступно</Button>);

        const button = getByRole('button');
        expect(button.className).toMatch(/\bdisabled:bg-muted\b/);
        expect(button.className).toMatch(/\bdisabled:text-text-dim\b/);
        expect(button.className).not.toMatch(/disabled:opacity/);
    });
});
