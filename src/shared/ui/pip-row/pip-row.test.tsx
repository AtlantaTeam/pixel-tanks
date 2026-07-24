import { render } from '@testing-library/react';
import { PipRow } from './pip-row';

describe('PipRow', () => {
    it('renders active pips with accent color by default', () => {
        const { container } = render(<PipRow pips={[true, true, false]} />);

        const pips = container.querySelectorAll('[data-testid="pip"]');
        expect(pips).toHaveLength(3);
        expect((pips[0] as HTMLElement).style.opacity).toBe('1');
        expect((pips[1] as HTMLElement).style.opacity).toBe('1');
        expect((pips[2] as HTMLElement).style.opacity).toBe('0.5');
    });

    it('renders pips with custom color', () => {
        const { container } = render(<PipRow pips={[true, false]} color="var(--color-warning)" />);

        const pips = container.querySelectorAll('[data-testid="pip"]');
        const activePip = pips[0] as HTMLElement;
        expect(activePip.style.background).toBe('var(--color-warning)');
        expect(activePip.style.borderColor).toBe('var(--color-warning)');
    });

    it('renders inactive pips with border-strong color and no glow', () => {
        const { container } = render(<PipRow pips={[false, false]} />);

        const pips = container.querySelectorAll('[data-testid="pip"]');
        pips.forEach((pip) => {
            const el = pip as HTMLElement;
            expect(el).toHaveStyle('background: transparent');
            expect(el.style.borderColor).toBe('var(--color-border-strong)');
            expect(el.style.opacity).toBe('0.5');
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
        expect((pips[3] as HTMLElement).style.opacity).toBe('0.5');
    });

    it('renders turn pips (4 turns: 2 active in warning color)', () => {
        const { container } = render(
            <PipRow pips={[true, true, false, false]} color="var(--color-warning)" />,
        );

        const pips = container.querySelectorAll('[data-testid="pip"]');
        expect(pips).toHaveLength(4);
        expect((pips[0] as HTMLElement).style.background).toBe('var(--color-warning)');
    });

    it('each pip is 14x14px with 2px border', () => {
        const { container } = render(<PipRow pips={[true]} />);

        const pip = container.querySelector('[data-testid="pip"]') as HTMLElement;
        expect(pip.style.width).toBe('14px');
        expect(pip.style.height).toBe('14px');
        expect(pip.style.border).toContain('2px');
    });

    it('pips are displayed with flex layout and gap', () => {
        const { container } = render(<PipRow pips={[true, false, true]} />);

        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.className).toContain('flex');
        expect(wrapper.className).toContain('gap');
    });

    it('accepts a custom className', () => {
        const { container } = render(<PipRow pips={[true, false]} className="custom-pip-row" />);

        expect((container.firstChild as HTMLElement).className).toContain('custom-pip-row');
    });
});
