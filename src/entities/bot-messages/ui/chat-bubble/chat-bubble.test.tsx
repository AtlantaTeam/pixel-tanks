import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { ChatBubble } from './chat-bubble';
import { EBotReplyCategory, type TBotReply } from '../../t-bot-reply';

const happyReply: TBotReply = { text: 'Hasta la vista, baby', category: EBotReplyCategory.Happy };

/** Локальный мок `matchMedia` — не переиспользуем хелпер `game-engine` (entities
 *  не может импортировать из features, см. FSD в CLAUDE.md). */
function mockReducedMotion(matches: boolean): () => void {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(
        (query: string) =>
            ({
                matches,
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }) as unknown as MediaQueryList,
    );
    return () => {
        window.matchMedia = original;
    };
}

describe('ChatBubble', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('types out the reply text over time, not all at once', () => {
        const { getByText, queryByText } = render(
            <ChatBubble reply={happyReply} x={100} y={200} />,
        );

        // Ничего не показано сразу — печать ещё не началась.
        expect(queryByText('Hasta la vista, baby')).not.toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(35 * happyReply.text.length);
        });
        expect(getByText('Hasta la vista, baby')).toBeInTheDocument();
    });

    it('shows the full text immediately under prefers-reduced-motion (no typewriter)', () => {
        const restore = mockReducedMotion(true);
        const { getByText } = render(<ChatBubble reply={happyReply} x={100} y={200} />);

        expect(getByText('Hasta la vista, baby')).toBeInTheDocument();
        restore();
    });

    it('renders with a flat pixel-frame border, not the legacy pixel-border utility', () => {
        const { container } = render(<ChatBubble reply={happyReply} x={100} y={200} />);

        const bubble = container.firstElementChild as HTMLElement;
        expect(bubble.className).not.toMatch(/\bpixel-border\b/);
        expect(container.querySelector('p')).toHaveClass('font-ui');
    });

    it('is hidden from assistive tech (decorative teaser, not aria-live)', () => {
        const { container } = render(<ChatBubble reply={happyReply} x={100} y={200} />);

        const bubble = container.firstElementChild as HTMLElement;
        expect(bubble).toHaveAttribute('aria-hidden', 'true');
    });

    it('shows the bot name and a skull icon (identifies the speaker)', () => {
        const { getByText, container } = render(<ChatBubble reply={happyReply} x={100} y={200} />);

        expect(getByText('Terminator')).toBeInTheDocument();
        expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders a tail pointing down at the anchor, centered under the bubble', () => {
        const { container } = render(<ChatBubble reply={happyReply} x={100} y={200} />);

        const tail = container.querySelector('span[style*="border-top-color"]');
        expect(tail).not.toBeNull();
        expect(tail).toHaveClass('left-1/2', '-translate-x-1/2');
    });

    it('positions itself above the given coordinates', () => {
        const { container } = render(<ChatBubble reply={happyReply} x={100} y={200} />);

        const bubble = container.firstElementChild as HTMLElement;
        expect(bubble.style.left).toBe('100px');
        expect(bubble.style.top).toBe('200px');
    });

    it('calls onExpire after the default timeout', () => {
        const onExpire = vi.fn();
        render(<ChatBubble reply={happyReply} x={0} y={0} onExpire={onExpire} />);

        act(() => {
            vi.advanceTimersByTime(2999);
        });
        expect(onExpire).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('calls onExpire after a custom durationMs', () => {
        const onExpire = vi.fn();
        render(<ChatBubble reply={happyReply} x={0} y={0} durationMs={500} onExpire={onExpire} />);

        act(() => {
            vi.advanceTimersByTime(500);
        });
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('does not call onExpire after unmount', () => {
        const onExpire = vi.fn();
        const { unmount } = render(
            <ChatBubble reply={happyReply} x={0} y={0} durationMs={500} onExpire={onExpire} />,
        );

        unmount();
        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(onExpire).not.toHaveBeenCalled();
    });

    it('restarts the timer when reply changes', () => {
        const onExpire = vi.fn();
        const angryReply: TBotReply = { text: 'Эй, полегче!', category: EBotReplyCategory.Angry };
        const { rerender } = render(
            <ChatBubble reply={happyReply} x={0} y={0} durationMs={1000} onExpire={onExpire} />,
        );

        act(() => {
            vi.advanceTimersByTime(700);
        });
        rerender(
            <ChatBubble reply={angryReply} x={0} y={0} durationMs={1000} onExpire={onExpire} />,
        );
        act(() => {
            vi.advanceTimersByTime(700);
        });
        expect(onExpire).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it.each([
        [EBotReplyCategory.Happy, 'var(--color-accent)'],
        [EBotReplyCategory.Angry, 'var(--color-danger)'],
        [EBotReplyCategory.Sarcasm, 'var(--color-primary)'],
    ])('maps %s category to its accent color', (category, expectedColor) => {
        const { container } = render(<ChatBubble reply={{ text: 'т', category }} x={0} y={0} />);

        const bubble = container.firstElementChild as HTMLElement;
        expect(bubble.style.borderColor).toBe(expectedColor);
    });
});

describe('ChatBubble — не мешает прицеливанию (#527)', () => {
    const reply: TBotReply = { text: 'Мимо, железяка', category: EBotReplyCategory.Happy };

    it('гаснет, пока игрок тянет рогатку', () => {
        const { container } = render(<ChatBubble reply={reply} x={100} y={100} dimmed />);
        expect(container.firstElementChild).toHaveClass('opacity-0');
    });

    it('видна, когда жеста нет', () => {
        const { container } = render(<ChatBubble reply={reply} x={100} y={100} />);
        expect(container.firstElementChild).not.toHaveClass('opacity-0');
    });

    it('на узком экране бабл вдвое компактнее — не накрывает арену', () => {
        const { container } = render(<ChatBubble reply={reply} x={100} y={100} />);
        // База — узкий экран, sm: возвращает прежние 260 px на десктопе.
        expect(container.firstElementChild).toHaveClass('max-w-[168px]');
        expect(container.firstElementChild).toHaveClass('sm:max-w-[260px]');
    });
});
