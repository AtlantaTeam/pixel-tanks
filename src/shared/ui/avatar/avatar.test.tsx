import { render } from '@testing-library/react';
import { Avatar } from './avatar';

describe('Avatar', () => {
    it('renders as a square 56px container with border and glow', () => {
        const { container } = render(<Avatar faction="player">A</Avatar>);

        const avatar = container.querySelector('[class*="size-14"]');
        expect(avatar).toHaveClass('size-14');
        expect(avatar).toHaveClass('border-[3px]');
        expect(avatar).toHaveClass('bg-surface');
    });

    it('renders player faction with accent theme', () => {
        const { container } = render(<Avatar faction="player">A</Avatar>);

        const avatar = container.firstChild as HTMLElement;
        expect(avatar).toHaveAttribute('data-faction', 'player');
        expect(avatar.className).toContain('border-[color:var(--accent)]');
    });

    it('renders enemy faction with enemy theme', () => {
        const { container } = render(<Avatar faction="enemy">B</Avatar>);

        const avatar = container.firstChild as HTMLElement;
        expect(avatar).toHaveAttribute('data-faction', 'enemy');
        expect(avatar.className).toContain('border-[color:var(--accent)]');
    });

    it('displays the provided icon prop as center-aligned content', () => {
        const { getByText } = render(<Avatar faction="player" icon="A" />);

        const icon = getByText('A');
        expect(icon).toHaveClass('text-[26px]');
    });

    it('applies glow effect via CSS var --glow', () => {
        const { container } = render(<Avatar faction="player">A</Avatar>);

        const avatar = container.firstChild as HTMLElement;
        expect(avatar.className).toContain('shadow-[var(--glow)]');
    });

    it('accepts custom className prop', () => {
        const { container } = render(
            <Avatar faction="player" className="custom-class">
                A
            </Avatar>,
        );

        const avatar = container.firstChild as HTMLElement;
        expect(avatar.className).toContain('custom-class');
    });
});
