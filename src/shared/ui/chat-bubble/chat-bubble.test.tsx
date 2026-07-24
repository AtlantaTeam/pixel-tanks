import { render } from '@testing-library/react';
import { ChatBubble } from './chat-bubble';

describe('ChatBubble', () => {
    it('renders the speaker name and message', () => {
        const { getByText } = render(
            <ChatBubble faction="enemy" speaker="Терминатор" message="Считай ветер." />,
        );

        expect(getByText('Терминатор')).toBeInTheDocument();
        expect(getByText('Считай ветер.')).toBeInTheDocument();
    });

    it('sets data-faction="enemy" for the enemy faction', () => {
        const { container } = render(
            <ChatBubble faction="enemy" speaker="Терминатор" message="..." />,
        );

        expect(container.firstChild).toHaveAttribute('data-faction', 'enemy');
    });

    it('sets data-faction="player" for the player faction', () => {
        const { container } = render(<ChatBubble faction="player" speaker="Игрок" message="..." />);

        expect(container.firstChild).toHaveAttribute('data-faction', 'player');
    });

    it('renders the skull icon for the enemy faction', () => {
        const { container } = render(
            <ChatBubble faction="enemy" speaker="Терминатор" message="..." />,
        );

        expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders a decorative tail pointer', () => {
        const { getByTestId } = render(
            <ChatBubble faction="enemy" speaker="Терминатор" message="..." />,
        );

        expect(getByTestId('chat-bubble-tail')).toHaveAttribute('aria-hidden');
    });

    it('accepts a custom className', () => {
        const { container } = render(
            <ChatBubble
                faction="enemy"
                speaker="Терминатор"
                message="..."
                className="custom-chat-bubble"
            />,
        );

        expect((container.firstChild as HTMLElement).className).toContain('custom-chat-bubble');
    });
});
