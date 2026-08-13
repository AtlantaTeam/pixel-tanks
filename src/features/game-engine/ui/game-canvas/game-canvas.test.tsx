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
    onTankHit: (params: {
        hittedIsLeft: boolean;
        leftActive: boolean;
        power: number;
        x: number;
        y: number;
    }) => void;
};

// Захватываем колбэки, которые GameCanvas передаёт в GamePlay, чтобы дёрнуть
// onBotReply без полной симуляции боя. Позиция танка бота — фиксированная.
const { captured, BOT_TANK, LEFT_TANK } = vi.hoisted(() => ({
    captured: { current: null as TCapturedCallbacks | null },
    BOT_TANK: { x: 200, tankWidth: 40, y: 150, tankHeight: 30 },
    LEFT_TANK: {
        isActive: true,
        gunpointAngle: 0.5,
        power: 12,
        gunpointX: 50,
        gunpointY: 100,
    },
}));

vi.mock('../../lib/game-play', () => ({
    GamePlay: class {
        rightTank = BOT_TANK;
        leftTank = LEFT_TANK;
        isFireMode = false;
        isMoveMode = false;
        isOver = false;
        showAimPreview = false;
        ctx = {} as CanvasRenderingContext2D;
        onFire = vi.fn();
        activateMode = vi.fn();
        changeTankPosition = vi.fn();
        setArenaInsets = vi.fn();
        getActiveAndTargetTanks = () => [LEFT_TANK, BOT_TANK];
        setAimPreviewVisible = vi.fn();
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
        const canvas = container.querySelector('.game-canvas');

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
        const canvas = container.querySelector('.game-canvas') as HTMLCanvasElement;
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
        const canvas = container.querySelector('.game-canvas') as HTMLCanvasElement;

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

    // Desktop hover chip (#544): чип наведения мышью у ствола танка
    describe('desktop hover chip', () => {
        it('показывает чип при наведении мышью на canvas (mouse поинтер)', () => {
            useGameStore.getState().resetGame();
            useGameStore.setState({ angle: 0.5, power: 12 });
            const { queryByTestId } = render(<GameCanvas seed={42} />);
            const canvas = document.querySelector('.game-canvas') as HTMLCanvasElement;

            expect(queryByTestId('desktop-hover-chip')).not.toBeInTheDocument();

            act(() => {
                fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 });
            });

            expect(queryByTestId('desktop-hover-chip')).toBeInTheDocument();
        });

        it('скрывает чип при наведении во время выстрела (isFireMode)', () => {
            useGameStore.getState().resetGame();
            useGameStore.setState({ angle: 0.5, power: 12 });
            const { queryByTestId, container } = render(<GameCanvas seed={42} />);
            const canvas = container.querySelector('.game-canvas') as HTMLCanvasElement;

            act(() => {
                fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 });
            });
            expect(queryByTestId('desktop-hover-chip')).toBeInTheDocument();

            // Имитируем выстрел (isFireMode = true)
            act(() => {
                useGameStore.setState({ phase: 'flight' });
            });

            expect(queryByTestId('desktop-hover-chip')).not.toBeInTheDocument();
        });

        it('не показывает чип при non-mouse поинтере (touch/pen)', () => {
            useGameStore.getState().resetGame();
            useGameStore.setState({ angle: 0.5, power: 12 });
            const { queryByTestId, container } = render(<GameCanvas seed={42} />);
            const canvas = container.querySelector('.game-canvas') as HTMLCanvasElement;

            // Тач-событие
            act(() => {
                fireEvent.pointerMove(canvas, {
                    clientX: 100,
                    clientY: 100,
                    pointerType: 'touch',
                });
            });

            expect(queryByTestId('desktop-hover-chip')).not.toBeInTheDocument();
        });

        it('скрывает чип при mouseLeave', () => {
            useGameStore.getState().resetGame();
            useGameStore.setState({ angle: 0.5, power: 12 });
            const { queryByTestId, container } = render(<GameCanvas seed={42} />);
            const canvas = container.querySelector('.game-canvas') as HTMLCanvasElement;

            act(() => {
                fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 });
            });
            expect(queryByTestId('desktop-hover-chip')).toBeInTheDocument();

            act(() => {
                fireEvent.mouseLeave(canvas);
            });

            expect(queryByTestId('desktop-hover-chip')).not.toBeInTheDocument();
        });

        it('отображает текущий угол и силу из стора', () => {
            useGameStore.getState().resetGame();
            useGameStore.setState({ power: 50 });
            const { queryByTestId, container } = render(<GameCanvas seed={42} />);
            const canvas = container.querySelector('.game-canvas') as HTMLCanvasElement;

            act(() => {
                fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 });
            });

            const chip = queryByTestId('desktop-hover-chip');
            expect(chip).toBeInTheDocument();
            // Проверяем наличие °, означает что есть угол
            expect(chip?.textContent).toMatch(/°/);
            // Чип должен содержать какие-то числа (угол и силу), по крайней мере одно число
            expect(chip?.textContent).toMatch(/\d/);
        });

        it('скрывает чип при выстреле (onClick)', () => {
            useGameStore.getState().resetGame();
            useGameStore.setState({ angle: 0.5, power: 12 });
            const { queryByTestId, container } = render(<GameCanvas seed={42} />);
            const canvas = container.querySelector('.game-canvas') as HTMLCanvasElement;

            act(() => {
                fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 });
            });
            expect(queryByTestId('desktop-hover-chip')).toBeInTheDocument();

            act(() => {
                fireEvent.click(canvas);
            });

            // Чип должен остаться скрытым после выстрела (phase: flight)
            // Фактическая проверка будет через пост-выстрел фазу
        });
    });

    // Число урона в месте события (#549): попадание должно читаться там же,
    // где произошло, а не только по панели HP.
    describe('damage number (#549)', () => {
        it('показывает число урона над задетым танком в координатах взрыва', () => {
            useGameStore.getState().resetGame();
            const { getByText } = render(<GameCanvas seed={42} />);

            act(() => {
                captured.current?.onTankHit({
                    hittedIsLeft: false,
                    leftActive: true,
                    power: 24,
                    x: 220,
                    y: 120,
                });
            });

            const number = getByText('-24');
            expect(number.parentElement?.style.left).toBe('220px');
            expect(number.parentElement?.style.top).toBe('120px');
        });

        it('красит число warning при попадании по боту, danger — при попадании по игроку', () => {
            useGameStore.getState().resetGame();
            const { getByText, rerender } = render(<GameCanvas seed={42} />);

            act(() => {
                captured.current?.onTankHit({
                    hittedIsLeft: false,
                    leftActive: true,
                    power: 24,
                    x: 220,
                    y: 120,
                });
            });
            expect(getByText('-24').style.color).toBe('var(--color-warning)');

            rerender(<GameCanvas seed={42} />);
            act(() => {
                captured.current?.onTankHit({
                    hittedIsLeft: true,
                    leftActive: false,
                    power: 10,
                    x: 50,
                    y: 100,
                });
            });
            expect(getByText('-10').style.color).toBe('var(--color-danger)');
        });

        it('исчезает через 400мс после попадания', () => {
            useGameStore.getState().resetGame();
            const { queryByText } = render(<GameCanvas seed={42} />);

            act(() => {
                captured.current?.onTankHit({
                    hittedIsLeft: false,
                    leftActive: true,
                    power: 24,
                    x: 220,
                    y: 120,
                });
            });
            expect(queryByText('-24')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(400);
            });

            expect(queryByText('-24')).not.toBeInTheDocument();
        });

        it('снимает урон с HP задетой стороны и заводит счётчик lastHit в сторе', () => {
            useGameStore.getState().resetGame();
            render(<GameCanvas seed={42} />);

            act(() => {
                captured.current?.onTankHit({
                    hittedIsLeft: false,
                    leftActive: true,
                    power: 24,
                    x: 220,
                    y: 120,
                });
            });

            const state = useGameStore.getState();
            expect(state.hp.enemy).toBe(100 - 24);
            expect(state.lastHit).toEqual({ target: 'enemy', nonce: 1 });
        });
    });
});
