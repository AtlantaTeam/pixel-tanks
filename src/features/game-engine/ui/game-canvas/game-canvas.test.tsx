import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import { EBotReplyCategory, type TBotReply } from '@/entities/bot-messages';
import { GameCanvas } from './game-canvas';

type TBotReplyCb = (reply: TBotReply) => void;

// Захватываем колбэки, которые GameCanvas передаёт в GamePlay, чтобы дёрнуть
// onBotReply без полной симуляции боя. Позиция танка бота — фиксированная.
const { captured, BOT_TANK } = vi.hoisted(() => ({
    captured: { current: null as { onBotReply: TBotReplyCb } | null },
    BOT_TANK: { x: 200, tankWidth: 40, y: 150, tankHeight: 30 },
}));

vi.mock('../../lib/game-play', () => ({
    GamePlay: class {
        rightTank = BOT_TANK;
        isFireMode = false;
        constructor(..._args: unknown[]) {
            captured.current = _args[2] as { onBotReply: TBotReplyCb };
        }
        loadImages() {}
        destroy() {}
    },
}));

describe('GameCanvas', () => {
    it('disables native touch gestures (scroll/zoom) on the canvas element', () => {
        const { container } = render(<GameCanvas seed={42} />);
        const canvas = container.querySelector('canvas');

        expect(canvas).toHaveClass('touch-none');
    });

    it('renders the bot chat bubble above the bot tank when onBotReply fires', () => {
        const reply: TBotReply = {
            text: 'Hasta la vista, baby',
            category: EBotReplyCategory.Happy,
        };
        const { getByText } = render(<GameCanvas seed={42} />);

        act(() => {
            captured.current?.onBotReply(reply);
        });

        const bubble = getByText('Hasta la vista, baby');
        // x = bot.x + tankWidth / 2, y = bot.y - tankHeight (см. onBotReply).
        expect(bubble.style.left).toBe('220px');
        expect(bubble.style.top).toBe('120px');
    });
});
