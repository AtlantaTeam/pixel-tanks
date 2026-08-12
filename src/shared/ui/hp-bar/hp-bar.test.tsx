import { render } from '@testing-library/react';
import { HPBar } from './hp-bar';

describe('HPBar', () => {
    it('renders success fill above the warning threshold (61+)', () => {
        const { container } = render(<HPBar label="Игрок" value={100} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-success');
    });

    it('renders warning fill at the upper threshold boundary (60)', () => {
        const { container } = render(<HPBar label="Игрок" value={60} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-warning');
    });

    it('renders warning fill above the danger threshold (31)', () => {
        const { container } = render(<HPBar label="Игрок" value={31} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-warning');
    });

    it('renders danger fill at the lower threshold boundary (30)', () => {
        const { container } = render(<HPBar label="Игрок" value={30} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-danger');
    });

    it('renders danger fill at zero HP', () => {
        const { container } = render(<HPBar label="Игрок" value={0} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-danger');
        expect(fill.style.width).toBe('0%');
    });

    it('clamps fill width for values above 100', () => {
        const { container } = render(<HPBar label="Игрок" value={140} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill.style.width).toBe('100%');
    });

    it('clamps fill width for negative values', () => {
        const { container } = render(<HPBar label="Игрок" value={-20} faction="player" />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill.style.width).toBe('0%');
    });

    it('shows label and tabular HP caption', () => {
        const { getByText } = render(<HPBar label="Игрок 1" value={72} faction="player" />);

        expect(getByText('Игрок 1')).toBeInTheDocument();
        expect(getByText('72/100')).toBeInTheDocument();
    });

    it('renders the star icon for the player faction', () => {
        const { container } = render(<HPBar label="Игрок" value={72} faction="player" />);

        expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders the skull icon for the enemy faction', () => {
        const { container } = render(<HPBar label="Враг" value={38} faction="enemy" />);

        expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('accepts a custom className', () => {
        const { container } = render(
            <HPBar label="Игрок" value={72} faction="player" className="custom-hp-bar" />,
        );

        expect((container.firstChild as HTMLElement).className).toContain('custom-hp-bar');
    });

    it('scales fill width and caption against a custom max', () => {
        const { container, getByText } = render(
            <HPBar label="Босс" value={75} faction="enemy" max={150} />,
        );

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill.style.width).toBe('50%');
        expect(getByText('75/150')).toBeInTheDocument();
    });

    it('computes color thresholds as percentages of a custom max', () => {
        // 75/150 = 50% → warning (не success, хотя сырое значение 75 > 60)
        const { container } = render(<HPBar label="Босс" value={75} faction="enemy" max={150} />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill).toHaveClass('bg-warning');
    });

    it('clamps fill to the custom max for overshooting values', () => {
        const { container } = render(<HPBar label="Босс" value={999} faction="enemy" max={150} />);

        const fill = container.querySelector('[data-testid="hp-bar-fill"]') as HTMLElement;
        expect(fill.style.width).toBe('100%');
    });

    it('exposes progressbar semantics for assistive tech', () => {
        const { getByRole } = render(<HPBar label="Игрок" value={72} faction="player" />);

        const bar = getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '72');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
    });
});
