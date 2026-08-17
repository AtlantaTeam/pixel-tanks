import { render } from '@testing-library/react';
import { Button, buttonClasses } from './button';

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

    it('renders outline variant as a themed accent outline, without a fill', () => {
        const { getByRole } = render(<Button variant="outline">Поделиться реплеем</Button>);

        const button = getByRole('button');
        expect(button.className).toMatch(/var\(--accent\)/);
        expect(button.className).toMatch(/\bbg-transparent\b/);
        expect(button.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
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

    // #554: классы собирались простой конкатенацией (clsx), поэтому при равной
    // специфичности исход решал порядок в СГЕНЕРИРОВАННОМ Tailwind-стиле, а не
    // порядок в атрибуте. `className="m-0"` не перебивал базовый `m-1` —
    // у 13 кнопок в коде оставался живой `margin: 4px`.
    describe('слияние конфликтующих utility-классов (#554)', () => {
        it('drops the base margin when the caller passes m-0', () => {
            const { getByRole } = render(<Button className="m-0">Пауза</Button>);

            const button = getByRole('button');
            expect(button.className).toMatch(/\bm-0\b/);
            expect(button.className).not.toMatch(/\bm-1\b/);
        });

        it('keeps the base margin when the caller passes no className', () => {
            const { getByRole } = render(<Button>Новая игра</Button>);

            expect(getByRole('button').className).toMatch(/\bm-1\b/);
        });

        it('keeps the base margin when the caller class does not conflict with it', () => {
            const { getByRole } = render(<Button className="flex-1">Играть</Button>);

            const button = getByRole('button');
            expect(button.className).toMatch(/\bm-1\b/);
            expect(button.className).toMatch(/\bflex-1\b/);
        });

        it('leaves an important-modified caller class alone instead of merging it', () => {
            // Граница инструмента, о которую спотыкались в #538: tailwind-merge
            // сливает только классы с ОДИНАКОВЫМ набором модификаторов, поэтому
            // `!m-0` базовый `m-1` из строки не выкидывает — он побеждает уже в
            // CSS, через `!important`. Работает, но лечит симптом: обходить баг
            // важностью больше не нужно, хватает простого `m-0`.
            const merged = buttonClasses('ghost', 'icon', '!m-0');

            expect(merged).toMatch(/!m-0/);
            expect(merged).toMatch(/\bm-1\b/);
        });

        it('lets the caller override variant and size utilities too, not just margin', () => {
            const merged = buttonClasses('primary', 'md', 'px-8 bg-transparent');

            expect(merged).toMatch(/\bpx-8\b/);
            expect(merged).not.toMatch(/\bpx-5\b/);
            expect(merged).toMatch(/\bbg-transparent\b/);
            expect(merged).not.toMatch(/\bbg-primary\b/);
        });

        it('keeps every variant/size class when nothing conflicts', () => {
            // Слияние не должно съедать «соседей» по префиксу: у ghost/danger/outline
            // ширина рамки (`border-[length:…]`) и её цвет (`border-*`) — разные
            // свойства, у sm/icon `text-[10px]` (размер) и `text-*` (цвет) — тоже.
            const ghost = buttonClasses('ghost', 'sm');
            expect(ghost).toMatch(/border-\[length:var\(--border-w\)\]/);
            expect(ghost).toMatch(/\bborder-border-strong\b/);
            expect(ghost).toMatch(/text-\[10px\]/);
            expect(ghost).toMatch(/\btext-text\b/);

            const primary = buttonClasses('primary', 'icon');
            expect(primary).toMatch(/shadow-\[var\(--edge-pixel\)\]/);
            expect(primary).toMatch(/\bdisabled:shadow-none\b/);
            expect(primary).toMatch(/\bsize-11\b/);
        });

        it('keeps the variant text colour when the caller passes a theme font size', () => {
            // Ревью #554: голый `twMerge` не знает кастомных `--text-*` из @theme и
            // считает `text-hud` ЦВЕТОМ — цвет варианта вылетал, размер варианта
            // оставался. Настроенный `shared/lib/tw-merge` разбирает их как размер.
            const merged = buttonClasses('accent', 'md', 'text-hud');

            expect(merged).toMatch(/\btext-hud\b/);
            expect(merged).toMatch(/text-\[var\(--accent-ink\)\]/);
            expect(merged).not.toMatch(/\btext-xs\b/);
        });
    });

    it('renders disabled state from semantic muted tokens, not opacity', () => {
        const { getByRole } = render(<Button disabled>Недоступно</Button>);

        const button = getByRole('button');
        expect(button.className).toMatch(/\bdisabled:bg-muted\b/);
        expect(button.className).toMatch(/\bdisabled:text-text-dim\b/);
        expect(button.className).not.toMatch(/disabled:opacity/);
    });
});
