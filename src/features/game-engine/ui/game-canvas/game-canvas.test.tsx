import { act, fireEvent, render } from '@testing-library/react';
import { vi } from 'vitest';
import { EBotReplyCategory, type TBotReply } from '@/entities/bot-messages';
import { useGameStore } from '../../model/game.store';
import { GameCanvas } from './game-canvas';

type TBotReplyCb = (reply: TBotReply) => void;

// Захватываем колбэки, которые GameCanvas передаёт в GamePlay, чтобы дёрнуть
// onBotReply без полной симуляции боя. Позиция танка бота — фиксированная.
const { captured, BOT_TANK, LEFT_TANK } = vi.hoisted(() => ({
    captured: { current: null as { onBotReply: TBotReplyCb } | null },
    BOT_TANK: { x: 200, tankWidth: 40, y: 150, tankHeight: 30 },
    LEFT_TANK: { isActive: true, gunpointAngle: 0.5, power: 12 },
}));

vi.mock('../../lib/game-play', () => ({
    GamePlay: class {
        rightTank = BOT_TANK;
        leftTank = LEFT_TANK;
        isFireMode = false;
        showAimPreview = false;
        onFire = vi.fn();
        activateMode = vi.fn();
        getActiveAndTargetTanks = () => [LEFT_TANK, BOT_TANK];
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

    it('запоминает seed и записывает выстрел в реплей боя при клике по canvas', () => {
        useGameStore.getState().resetGame();
        useGameStore.setState({ angle: 0.5, power: 12 });
        const { container } = render(<GameCanvas seed={42} />);
        const canvas = container.querySelector('canvas') as HTMLCanvasElement;

        expect(useGameStore.getState().battleSeed).toBe(42);
        // Store → engine синк применил angle/power к leftTank ещё до клика.
        expect(LEFT_TANK.gunpointAngle).toBe(0.5);
        expect(LEFT_TANK.power).toBe(12);

        fireEvent.click(canvas);

        expect(useGameStore.getState().replayMoves).toEqual([
            { kind: 'fire', angle: 0.5, power: 12 },
        ]);
    });
});
