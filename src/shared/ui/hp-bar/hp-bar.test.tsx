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
        expect(getByText('HP 72 / 100')).toBeInTheDocument();
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
});
