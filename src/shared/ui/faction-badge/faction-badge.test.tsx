import { render } from '@testing-library/react';
import { FactionBadge } from './faction-badge';

describe('FactionBadge', () => {
    it('renders player faction with player icon and theme', () => {
        const { container } = render(<FactionBadge faction="player" />);

        const badge = container.firstChild as HTMLElement;
        expect(badge).toHaveAttribute('data-faction', 'player');
        expect(badge.querySelector('svg')).toBeInTheDocument();
    });

    it('renders enemy faction with enemy icon and theme', () => {
        const { container } = render(<FactionBadge faction="enemy" />);

        const badge = container.firstChild as HTMLElement;
        expect(badge).toHaveAttribute('data-faction', 'enemy');
        expect(badge.querySelector('svg')).toBeInTheDocument();
    });

    it('renders unknown faction as gray badge without data-faction', () => {
        const { container } = render(<FactionBadge faction="unknown" />);

        const badge = container.firstChild as HTMLElement;
        expect(badge).not.toHaveAttribute('data-faction');
        expect(badge).toHaveTextContent('?');
        expect(badge.className).toContain('bg-muted');
        expect(badge.className).toContain('border-border-strong');
    });

    it('applies md size as default (56×56 pixels)', () => {
        const { container } = render(<FactionBadge faction="player" />);

        const badge = container.firstChild as HTMLElement;
        expect(badge).toHaveClass('size-14');
    });

    it('applies sm size when specified (44×44 pixels)', () => {
        const { container } = render(<FactionBadge faction="player" size="sm" />);

        const badge = container.firstChild as HTMLElement;
        expect(badge).toHaveClass('size-11');
    });

    it('sets its own data-faction, overriding the parent theme axis', () => {
        const { container } = render(
            <div data-faction="enemy">
                <FactionBadge faction="player" />
            </div>,
        );

        // Бейдж привязан к своей стороне: ставит собственный data-faction="player"
        // поверх enemy-предка, а не наследует чужую тему.
        const badge = container.querySelector('[data-faction="player"]') as HTMLElement;
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('var(--accent)');
    });

    it('accepts custom className prop', () => {
        const { container } = render(<FactionBadge faction="player" className="custom-badge" />);

        const badge = container.firstChild as HTMLElement;
        expect(badge.className).toContain('custom-badge');
    });
});
