import { createRef } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { vi } from 'vitest';
import { EBotReplyCategory, type TBotReply } from '@/entities/bot-messages';
import { useGameStore } from '../../model/game.store';
import { GameCanvas, type TGameCanvasHandle } from './game-canvas';

type TBotReplyCb = (reply: TBotReply) => void;
type TCapturedCallbacks = {
    onBotReply: TBotReplyCb;
    onWindInit?: (wind: number) => void;
    onTurnChange?: (turn: 'player' | 'enemy') => void;
    onShotStart?: () => void;
    onShotEnd?: () => void;
};

// Захватываем колбэки, которые GameCanvas передаёт в GamePlay, чтобы дёрнуть
// onBotReply без полной симуляции боя. Позиция танка бота — фиксированная.
const { captured, BOT_TANK, LEFT_TANK } = vi.hoisted(() => ({
    captured: { current: null as TCapturedCallbacks | null },
    BOT_TANK: { x: 200, tankWidth: 40, y: 150, tankHeight: 30 },
    LEFT_TANK: { isActive: true, gunpointAngle: 0.5, power: 12 },
}));

vi.mock('../../lib/game-play', () => ({
    GamePlay: class {
        rightTank = BOT_TANK;
        leftTank = LEFT_TANK;
        isFireMode = false;
        isMoveMode = false;
        isOver = false;
        showAimPreview = false;
        onFire = vi.fn();
        activateMode = vi.fn();
        changeTankPosition = vi.fn();
        getActiveAndTargetTanks = () => [LEFT_TANK, BOT_TANK];
        constructor(..._args: unknown[]) {
            captured.current = _args[2] as TCapturedCallbacks;
        }
        loadImages() {}
        destroy() {}
    },
}));

describe('GameCanvas', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

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
        // Отдельный act: печать бабла (~35 мс/символ) стартует эффектом ПОСЛЕ
        // монтирования — таймер должен успеть создаться до advanceTimersByTime.
        act(() => {
            vi.advanceTimersByTime(35 * reply.text.length);
        });

        const bubble = getByText('Hasta la vista, baby').parentElement as HTMLElement;
        // x = bot.x + tankWidth / 2, y = bot.y - tankHeight (см. onBotReply).
        expect(bubble.style.left).toBe('220px');
        expect(bubble.style.top).toBe('120px');
    });

    it('positions bubble relative to canvas container, not outer ancestors', () => {
        const reply: TBotReply = {
            text: 'Test bubble',
            category: EBotReplyCategory.Happy,
        };
        const { container, getByText } = render(<GameCanvas seed={42} />);

        act(() => {
            captured.current?.onBotReply(reply);
        });
        act(() => {
            vi.advanceTimersByTime(35 * reply.text.length);
        });

        // Найти relative-контейнер, который содержит canvas
        const canvas = container.querySelector('canvas') as HTMLCanvasElement;
        const relativeContainer = canvas?.parentElement;

        // Контейнер должен иметь relative позиционирование
        expect(relativeContainer).toBeTruthy();
        expect(relativeContainer).toHaveClass('relative');

        // Bubble должен быть потомком relative-контейнера
        const bubble = getByText('Test bubble') as HTMLElement;
        expect(relativeContainer?.contains(bubble)).toBe(true);
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

    it('стартует фазовую машину верхнего HUD при монтировании (aiming, ход игрока)', () => {
        useGameStore.getState().resetGame();

        render(<GameCanvas seed={42} />);

        const state = useGameStore.getState();
        expect(state.phase).toBe('aiming');
        expect(state.turn).toBe('player');
    });

    it('onWindInit запоминает ветер боя в сторе', () => {
        useGameStore.getState().resetGame();
        render(<GameCanvas seed={42} />);

        act(() => {
            captured.current?.onWindInit?.(-0.006);
        });

        expect(useGameStore.getState().wind).toBe(-0.006);
    });

    it('onTurnChange переключает сторону хода в сторе', () => {
        useGameStore.getState().resetGame();
        render(<GameCanvas seed={42} />);

        act(() => {
            captured.current?.onTurnChange?.('enemy');
        });

        expect(useGameStore.getState().turn).toBe('enemy');
    });

    it('показывает маджента-рамку арены на ходе бота (handoff «Ход бота»)', () => {
        useGameStore.getState().resetGame();
        const { queryByTestId } = render(<GameCanvas seed={42} />);

        expect(queryByTestId('arena-turn-ring')).not.toBeInTheDocument();

        act(() => {
            captured.current?.onTurnChange?.('enemy');
        });

        expect(queryByTestId('arena-turn-ring')).toBeInTheDocument();
    });

    it('скрывает рамку арены после конца боя, даже если ход был за ботом', () => {
        useGameStore.getState().resetGame();
        const { queryByTestId } = render(<GameCanvas seed={42} />);

        act(() => {
            captured.current?.onTurnChange?.('enemy');
            useGameStore.setState({ phase: 'over' });
        });

        expect(queryByTestId('arena-turn-ring')).not.toBeInTheDocument();
    });

    it('onShotStart переводит фазу в полёт, onShotEnd возвращает в прицеливание', () => {
        useGameStore.getState().resetGame();
        render(<GameCanvas seed={42} />);
        expect(useGameStore.getState().phase).toBe('aiming');

        act(() => {
            captured.current?.onShotStart?.();
        });
        expect(useGameStore.getState().phase).toBe('flight');

        act(() => {
            captured.current?.onShotEnd?.();
        });
        expect(useGameStore.getState().phase).toBe('aiming');
    });

    // Императивный API (`TGameCanvasHandle`) — доступ палубы (`widgets/game-controls`)
    // к манёвру/выстрелу без дублирования доступа к движку снаружи (см. докблок типа).
    describe('императивный API (fire/moveLeft/moveRight)', () => {
        it('fire() стреляет текущим выбранным оружием — как клик по канвасу', () => {
            useGameStore.getState().resetGame();
            useGameStore.setState({ angle: 0.5, power: 12 });
            const ref = createRef<TGameCanvasHandle>();
            render(<GameCanvas ref={ref} seed={42} />);

            act(() => {
                ref.current?.fire();
            });

            expect(useGameStore.getState().replayMoves).toEqual([
                { kind: 'fire', angle: 0.5, power: 12 },
            ]);
        });

        it('moveRight() двигает танк и записывает манёвр в реплей', () => {
            useGameStore.getState().resetGame();
            const ref = createRef<TGameCanvasHandle>();
            render(<GameCanvas ref={ref} seed={42} />);

            act(() => {
                ref.current?.moveRight();
            });

            expect(useGameStore.getState().replayMoves).toEqual([{ kind: 'move', delta: 150 }]);
        });

        it('moveRight() ничего не делает на ходе бота (leftTank не активен)', () => {
            useGameStore.getState().resetGame();
            const ref = createRef<TGameCanvasHandle>();
            render(<GameCanvas ref={ref} seed={42} />);
            // Ход бота: активен правый танк — тот же гард, что у клавиатуры/выстрела,
            // иначе манёвр сдвинул бы чужой танк и записал ложный ход в реплей.
            LEFT_TANK.isActive = false;
            try {
                act(() => {
                    ref.current?.moveRight();
                });

                expect(useGameStore.getState().replayMoves).toEqual([]);
            } finally {
                LEFT_TANK.isActive = true;
            }
        });

        it('moveLeft() ничего не делает, если ходы манёвра исчерпаны', () => {
            useGameStore.getState().resetGame();
            const ref = createRef<TGameCanvasHandle>();
            render(<GameCanvas ref={ref} seed={42} />);
            // startGame() при монтировании сбрасывает moves на MOVE_BUDGET — бюджет
            // обнуляем ПОСЛЕ рендера, иначе mount-эффект его тут же перезапишет.
            act(() => {
                useGameStore.setState({ moves: 0 });
            });

            act(() => {
                ref.current?.moveLeft();
            });

            expect(useGameStore.getState().replayMoves).toEqual([]);
        });
    });
});
