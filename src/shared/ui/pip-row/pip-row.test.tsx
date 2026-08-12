import { render } from '@testing-library/react';
import { PipRow } from './pip-row';

describe('PipRow', () => {
    it('renders active pips at full opacity and inactive ones dimmed', () => {
        const { container } = render(<PipRow pips={[true, true, false]} />);

        const pips = container.querySelectorAll('[data-testid="pip"]');
        expect(pips).toHaveLength(3);
        expect(pips[0]).not.toHaveClass('opacity-50');
        expect(pips[1]).not.toHaveClass('opacity-50');
        expect(pips[2]).toHaveClass('opacity-50');
    });

    it('renders active pips with custom color', () => {
        const { container } = render(<PipRow pips={[true, false]} color="var(--color-warning)" />);

        const pips = container.querySelectorAll('[data-testid="pip"]');
        const activePip = pips[0] as HTMLElement;
        expect(activePip.style.background).toBe('var(--color-warning)');
        expect(activePip.style.borderColor).toBe('var(--color-warning)');
    });

    it('renders inactive pips with border-strong color and no inline color', () => {
        const { container } = render(<PipRow pips={[false, false]} />);

        const pips = container.querySelectorAll('[data-testid="pip"]');
        pips.forEach((pip) => {
            const el = pip as HTMLElement;
            expect(el).toHaveClass('border-border-strong');
            expect(el).toHaveClass('opacity-50');
            expect(el.style.background).toBe('');
        });
    });

    it('renders empty array as no pips', () => {
        const { container } = render(<PipRow pips={[]} />);

        const pips = container.querySelectorAll('[data-testid="pip"]');
        expect(pips).toHaveLength(0);
    });

    it('renders shell pips (5 shells: 3 active)', () => {
        const { container } = render(<PipRow pips={[true, true, true, false, false]} />);

        const pips = container.querySelectorAll('[data-testid="pip"]');
        expect(pips).toHaveLength(5);
        expect(pips[3]).toHaveClass('opacity-50');
    });

    it('renders turn pips (4 turns: 2 active in warning color)', () => {
        const { container } = render(
            <PipRow pips={[true, true, false, false]} color="var(--color-warning)" />,
        );

        const pips = container.querySelectorAll('[data-testid="pip"]');
        expect(pips).toHaveLength(4);
        expect((pips[0] as HTMLElement).style.background).toBe('var(--color-warning)');
    });

    it('each pip is a 14×14px square with a 2px border (Tailwind utilities)', () => {
        const { container } = render(<PipRow pips={[true]} />);

        const pip = container.querySelector('[data-testid="pip"]') as HTMLElement;
        expect(pip).toHaveClass('size-3.5');
        expect(pip).toHaveClass('border-2');
    });

    it('pips are displayed with flex layout and gap', () => {
        const { container } = render(<PipRow pips={[true, false, true]} />);

        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.className).toContain('flex');
        expect(wrapper.className).toContain('gap-[5px]');
    });

    it('компактный зазор (#450): кастомный gap задаётся inline, дефолтный класс снят', () => {
        const { container } = render(<PipRow pips={[true, false, true]} gap={2} />);

        const wrapper = container.firstChild as HTMLElement;
        // Нестандартный зазор — через inline style (как нестандартный размер),
        // дефолтный `gap-[5px]` при этом не навешивается, чтобы не конфликтовать.
        expect(wrapper.className).not.toContain('gap-[5px]');
        expect(wrapper.style.gap).toBe('2px');
    });

    it('exposes an aria-label summarizing active pips for screen readers', () => {
        const { getByRole } = render(
            <PipRow pips={[true, true, true, false, false]} label="снарядов" />,
        );

        expect(getByRole('img')).toHaveAttribute('aria-label', '3 из 5 снарядов');
    });

    it('accepts a custom className', () => {
        const { container } = render(<PipRow pips={[true, false]} className="custom-pip-row" />);

        expect((container.firstChild as HTMLElement).className).toContain('custom-pip-row');
    });

    it('renders smaller pips at a custom size (handoff: ветер до пристрелки — 10×10)', () => {
        const { container } = render(<PipRow pips={[true, false]} size={10} />);

        const pip = container.querySelector('[data-testid="pip"]') as HTMLElement;
        expect(pip).not.toHaveClass('size-3.5');
        expect(pip.style.width).toBe('10px');
        expect(pip.style.height).toBe('10px');
    });
});
