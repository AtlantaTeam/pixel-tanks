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

    it('renders danger variant as a flat outline, not a competing legacy border', () => {
        const { getByRole } = render(<Button variant="danger">Сдаться</Button>);

        const button = getByRole('button');
        expect(button.className).toMatch(/\bborder-danger\b/);
        expect(button.className).toMatch(/\btext-danger\b/);
        expect(button.className).toMatch(/\bbg-transparent\b/);
        expect(button.className).not.toMatch(/\bpixel-border\b/);
    });

    it('feeds edge/glow into box-shadow tokens directly, without the legacy pixel-border utility', () => {
        const { getByRole } = render(<Button variant="primary">Играть</Button>);

        const button = getByRole('button');
        expect(button.className).toMatch(/shadow-\[var\(--edge-pixel\)\]/);
        expect(button.className).not.toMatch(/\bpixel-border\b/);
    });

    it('renders a keyboard focus ring via the ring-focus token', () => {
        const { getByRole } = render(<Button>Играть</Button>);

        // Кольцо задаётся в фокус-тени (может делить её с edge у primary/accent).
        expect(getByRole('button').className).toMatch(
            /focus-visible:shadow-\[[^\]]*var\(--ring-focus\)[^\]]*\]/,
        );
    });

    it('keeps the primary 3D edge under keyboard focus (edge composed with the ring)', () => {
        const { getByRole } = render(<Button variant="primary">Играть</Button>);

        // Регресс, который сторожим: голое focus-visible:shadow-[--ring-focus]
        // перебивало бы базовый edge (box-shadow — одно свойство), съедая грань.
        expect(getByRole('button').className).toMatch(
            /focus-visible:shadow-\[var\(--edge-pixel\),var\(--ring-focus\)\]/,
        );
    });

    it('gives the flat ghost variant a ring-only focus (no phantom edge)', () => {
        const { getByRole } = render(<Button variant="ghost">Меню</Button>);

        // У ghost грани нет (рамка через border) — фокус только кольцо, без edge.
        expect(getByRole('button').className).toMatch(
            /focus-visible:shadow-\[var\(--ring-focus\)\]/,
        );
        expect(getByRole('button').className).not.toMatch(/var\(--edge-pixel\)/);
    });

    it('renders disabled state from semantic muted tokens, not opacity', () => {
        const { getByRole } = render(<Button disabled>Недоступно</Button>);

        const button = getByRole('button');
        expect(button.className).toMatch(/\bdisabled:bg-muted\b/);
        expect(button.className).toMatch(/\bdisabled:text-text-dim\b/);
        expect(button.className).not.toMatch(/disabled:opacity/);
    });
});
