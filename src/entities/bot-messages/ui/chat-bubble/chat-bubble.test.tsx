import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ChatBubble } from './chat-bubble';
import { EBotReplyCategory, type TBotReply } from '../../t-bot-reply';

const happyReply: TBotReply = { text: 'Hasta la vista, baby', category: EBotReplyCategory.Happy };

describe('ChatBubble', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders reply text', () => {
        const { getByText } = render(<ChatBubble reply={happyReply} x={100} y={200} />);

        expect(getByText('Hasta la vista, baby')).toBeInTheDocument();
    });

    it('renders in pixel-border game style', () => {
        const { getByText } = render(<ChatBubble reply={happyReply} x={100} y={200} />);

        expect(getByText('Hasta la vista, baby')).toHaveClass('pixel-border', 'font-pixel');
    });

    it('is hidden from assistive tech (decorative teaser, not aria-live)', () => {
        const { getByText } = render(<ChatBubble reply={happyReply} x={100} y={200} />);

        expect(getByText('Hasta la vista, baby')).toHaveAttribute('aria-hidden', 'true');
    });

    it('positions itself above the given coordinates', () => {
        const { getByText } = render(<ChatBubble reply={happyReply} x={100} y={200} />);

        const bubble = getByText('Hasta la vista, baby');
        expect(bubble.style.left).toBe('100px');
        expect(bubble.style.top).toBe('200px');
    });

    it('calls onExpire after the default timeout', () => {
        const onExpire = vi.fn();
        render(<ChatBubble reply={happyReply} x={0} y={0} onExpire={onExpire} />);

        vi.advanceTimersByTime(2999);
        expect(onExpire).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('calls onExpire after a custom durationMs', () => {
        const onExpire = vi.fn();
        render(<ChatBubble reply={happyReply} x={0} y={0} durationMs={500} onExpire={onExpire} />);

        vi.advanceTimersByTime(500);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('does not call onExpire after unmount', () => {
        const onExpire = vi.fn();
        const { unmount } = render(
            <ChatBubble reply={happyReply} x={0} y={0} durationMs={500} onExpire={onExpire} />,
        );

        unmount();
        vi.advanceTimersByTime(500);

        expect(onExpire).not.toHaveBeenCalled();
    });

    it('restarts the timer when reply changes', () => {
        const onExpire = vi.fn();
        const angryReply: TBotReply = { text: 'Эй, полегче!', category: EBotReplyCategory.Angry };
        const { rerender } = render(
            <ChatBubble reply={happyReply} x={0} y={0} durationMs={1000} onExpire={onExpire} />,
        );

        vi.advanceTimersByTime(700);
        rerender(
            <ChatBubble reply={angryReply} x={0} y={0} durationMs={1000} onExpire={onExpire} />,
        );
        vi.advanceTimersByTime(700);
        expect(onExpire).not.toHaveBeenCalled();

        vi.advanceTimersByTime(300);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it.each([
        [EBotReplyCategory.Happy, 'var(--color-accent)'],
        [EBotReplyCategory.Angry, 'var(--color-danger)'],
        [EBotReplyCategory.Sarcasm, 'var(--color-primary)'],
    ])('maps %s category to its accent color', (category, expectedColor) => {
        const { getByText } = render(<ChatBubble reply={{ text: 'т', category }} x={0} y={0} />);

        expect(getByText('т').style.getPropertyValue('--pixel-border-color')).toBe(expectedColor);
    });
});
