'use client';

import { useEffect, useRef, useState } from 'react';
import { floor } from '@/shared/lib/canvas';
import { createSeededRandom } from '@/shared/lib/random';
import { ChatBubble, type TBotReply } from '@/entities/bot-messages';
import { useGameStore } from '../../model/game.store';
import { GamePlay } from '../../lib/game-play';
import { generateRandomWeapons, WEAPONS_AMOUNT } from '../../lib/weapons';
import { resolvePointsDelta } from '../../lib/score';
import { calculateDragAim } from '../../lib/drag-aim';
import { attachGestureGuard } from '../../lib/gesture-guard';
import { resolveKeyboardIntent } from '../../lib/keyboard-scheme';

type TDragState = {
    pointerId: number;
    startX: number;
    startY: number;
};

type TGameCanvasProps = {
    seed?: number | string;
};

export function GameCanvas({ seed }: TGameCanvasProps = {}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameRef = useRef<GamePlay | null>(null);
    const dragRef = useRef<TDragState | null>(null);
    // После тач-жеста браузер шлёт синтетический click — глотаем его,
    // чтобы тап/оттяжка не приводили к повторному выстрелу мышиной схемой.
    const suppressClickRef = useRef(false);

    const [botBubble, setBotBubble] = useState<{ reply: TBotReply; x: number; y: number } | null>(
        null,
    );

    const angle = useGameStore((s) => s.angle);
    const power = useGameStore((s) => s.power);
    const moves = useGameStore((s) => s.moves);
    const selectedWeapon = useGameStore((s) => s.selectedWeapon);
    const weapons = useGameStore((s) => s.weapons);

    const setAngle = useGameStore((s) => s.setAngle);
    const setPower = useGameStore((s) => s.setPower);
    const increasePower = useGameStore((s) => s.increasePower);
    const increaseAngle = useGameStore((s) => s.increaseAngle);
    const decrementMoves = useGameStore((s) => s.decrementMoves);
    const increasePlayerPoints = useGameStore((s) => s.increasePlayerPoints);
    const increaseEnemyPoints = useGameStore((s) => s.increaseEnemyPoints);
    const setWeapons = useGameStore((s) => s.setWeapons);
    const selectWeapon = useGameStore((s) => s.selectWeapon);
    const removeWeaponById = useGameStore((s) => s.removeWeaponById);
    const setGameOver = useGameStore((s) => s.setGameOver);
    const resetGame = useGameStore((s) => s.resetGame);
    const setBattleSeed = useGameStore((s) => s.setBattleSeed);
    const recordMove = useGameStore((s) => s.recordMove);
    const recordFire = useGameStore((s) => s.recordFire);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Размер бэкинг-стора canvas (dpr, resize) полностью на стороне GamePlay.fit().
        const battleSeed = seed ?? Date.now();
        setBattleSeed(battleSeed);
        const allWeapons = generateRandomWeapons(WEAPONS_AMOUNT);
        setWeapons(allWeapons.leftTankWeapons);
        selectWeapon(allWeapons.leftTankWeapons[0]);

        const game = new GamePlay(
            canvasRef,
            allWeapons,
            {
                onPointsCalc: (event) => {
                    const { isPlayer, delta } = resolvePointsDelta(event);
                    (isPlayer ? increasePlayerPoints : increaseEnemyPoints)(delta);
                },
                onGameOverCheck: ({ leftWeapons, rightWeapons }) => {
                    if (!leftWeapons && !rightWeapons && !game.isFireMode) {
                        setGameOver(true);
                    }
                },
                onMovesChange: (delta) => {
                    if (delta < 0) decrementMoves();
                },
                onPowerChange: (delta) => increasePower(delta),
                onBotReply: (reply) => {
                    const bot = game.rightTank;
                    if (!bot) return;
                    // Bubble всегда над танком бота (справа). Эмитится не на каждый
                    // выстрел: свой промах/самострел бот молчит (см. game-play.emitBotReply).
                    setBotBubble({
                        reply,
                        x: bot.x + bot.tankWidth / 2,
                        y: bot.y - bot.tankHeight,
                    });
                },
            },
            createSeededRandom(battleSeed),
            // Отдельный поток для косметики (частицы, тряска): их FPS-зависимое
            // потребление random не должно сдвигать выборки бота (см. GamePlay).
            createSeededRandom(`fx:${battleSeed}`),
        );
        gameRef.current = game;
        game.loadImages();

        return () => {
            game.destroy();
            gameRef.current = null;
            resetGame();
            setBotBubble(null);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Защита от конфликтов жестов: гасим iOS pinch-zoom (gesture*) и мультитач
    // на самом Canvas. touch-action: none (класс touch-none) закрывает остальное.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        return attachGestureGuard(canvas);
    }, []);

    // Sync store → engine (когда меняем угол/мощность через UI)
    useEffect(() => {
        const game = gameRef.current;
        if (!game?.leftTank || !game?.rightTank) return;
        const [activeTank] = game.getActiveAndTargetTanks(game.leftTank, game.rightTank);
        activeTank.power = power;
        const angleChanged = activeTank.gunpointAngle !== angle;
        activeTank.gunpointAngle = angle;
        // Будим рендер-цикл при смене угла ИЛИ мощности, пока видна линия прицела:
        // power-only оттяжка строго вдоль луча иначе выходит на isIdleMode()
        // и превью не удлиняется до первого изменения угла.
        if (angleChanged || game.showAimPreview) {
            game.activateMode('angle');
        }
    }, [angle, power]);

    // Управление клавиатурой
    useEffect(() => {
        const isInteractiveElementFocused = () => {
            const active = document.activeElement;
            if (!active) return false;
            const tagName = active.tagName.toLowerCase();
            return ['input', 'button', 'select', 'textarea'].includes(tagName);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            const game = gameRef.current;
            if (!game?.leftTank?.isActive || !game.rightTank) return;
            const intent = resolveKeyboardIntent(e.key, e.ctrlKey);
            if (!intent) return;

            if (intent === 'fire' && isInteractiveElementFocused()) return;

            e.preventDefault();

            switch (intent) {
                case 'power-down':
                    if (!game.isFireMode) game.changeTankPower(-1);
                    break;
                case 'power-up':
                    if (!game.isFireMode) game.changeTankPower(1);
                    break;
                case 'weapon-next':
                    if (!game.isFireMode && weapons.length > 0 && selectedWeapon) {
                        const idx = weapons.findIndex((w) => w.id === selectedWeapon.id);
                        const next = idx + 1 > weapons.length - 1 ? 0 : idx + 1;
                        selectWeapon(weapons[next]);
                    }
                    break;
                case 'weapon-prev':
                    if (!game.isFireMode && weapons.length > 0 && selectedWeapon) {
                        const idx = weapons.findIndex((w) => w.id === selectedWeapon.id);
                        const prev = idx - 1 < 0 ? weapons.length - 1 : idx - 1;
                        selectWeapon(weapons[prev]);
                    }
                    break;
                case 'angle-left':
                    if (!game.isFireMode) increaseAngle(-Math.PI / 180);
                    break;
                case 'angle-right':
                    if (!game.isFireMode) increaseAngle(Math.PI / 180);
                    break;
                case 'move-left':
                    if (!game.isFireMode && moves > 0 && !game.isMoveMode) {
                        game.changeTankPosition(-150);
                        recordMove(-150);
                    }
                    break;
                case 'move-right':
                    if (!game.isFireMode && moves > 0 && !game.isMoveMode) {
                        game.changeTankPosition(150);
                        recordMove(150);
                    }
                    break;
                case 'fire':
                    // Как мышь/тач: не стреляем, пока снаряд в полёте (isFireMode) —
                    // иначе повторный Enter/Space до смены хода даёт двойной выстрел
                    // и лишний раз тратит оружие (конфликт клавиатурной схемы с собой).
                    if (selectedWeapon && !game.isFireMode) {
                        recordFire(game.leftTank.gunpointAngle, game.leftTank.power);
                        game.onFire(selectedWeapon);
                        removeWeaponById(selectedWeapon.id);
                    }
                    break;
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [
        selectedWeapon,
        weapons,
        moves,
        selectWeapon,
        removeWeaponById,
        increaseAngle,
        recordMove,
        recordFire,
    ]);

    const fireSelectedWeapon = () => {
        const game = gameRef.current;
        if (!game || !selectedWeapon || game.isFireMode || !game.leftTank?.isActive) return;
        recordFire(game.leftTank.gunpointAngle, game.leftTank.power);
        game.onFire(selectedWeapon);
        removeWeaponById(selectedWeapon.id);
    };

    return (
        <>
            <canvas
                ref={canvasRef}
                className="game-canvas block h-full w-full touch-none bg-base-200"
                onPointerDown={(e) => {
                    // Мышь оставляем на своей схеме (движение — угол, клик — выстрел);
                    // жест «оттяни и отпусти» — для touch/pen.
                    if (e.pointerType === 'mouse') {
                        // Настоящий клик мыши всегда начинается с mouse-pointerdown —
                        // снимаем возможное залипшее подавление: после полного драга
                        // (не тапа) синтетический click не приходит и флаг остаётся true.
                        suppressClickRef.current = false;
                        return;
                    }
                    const game = gameRef.current;
                    if (!game?.leftTank?.isActive || game.isFireMode) return;
                    dragRef.current = {
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        startY: e.clientY,
                    };
                    game.setAimPreviewVisible(true);
                    try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {
                        // синтетические события (эмуляция) не имеют активного pointerId
                    }
                }}
                onPointerMove={(e) => {
                    const drag = dragRef.current;
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    const aim = calculateDragAim(
                        { x: drag.startX, y: drag.startY },
                        { x: e.clientX, y: e.clientY },
                    );
                    if (!aim) return;
                    setAngle(aim.angle);
                    setPower(aim.power);
                }}
                onPointerUp={(e) => {
                    const drag = dragRef.current;
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    dragRef.current = null;
                    suppressClickRef.current = true;
                    const game = gameRef.current;
                    game?.setAimPreviewVisible(false);
                    const aim = calculateDragAim(
                        { x: drag.startX, y: drag.startY },
                        { x: e.clientX, y: e.clientY },
                    );
                    if (!aim || !game?.leftTank || !game.rightTank) return;
                    // Движок обновляем напрямую: store-синк через useEffect может не
                    // успеть примениться до выстрела в этом же обработчике.
                    const [activeTank] = game.getActiveAndTargetTanks(
                        game.leftTank,
                        game.rightTank,
                    );
                    activeTank.gunpointAngle = aim.angle;
                    activeTank.power = aim.power;
                    setAngle(aim.angle);
                    setPower(aim.power);
                    fireSelectedWeapon();
                }}
                onPointerCancel={() => {
                    dragRef.current = null;
                    gameRef.current?.setAimPreviewVisible(false);
                }}
                onMouseMove={(e) => {
                    const game = gameRef.current;
                    if (!game || !game.leftTank?.isActive || game.isFireMode || !game.ctx) return;
                    const curAngle = Math.atan2(
                        floor(e.clientY - e.currentTarget.offsetTop) - game.leftTank.gunpointY,
                        floor(e.clientX - e.currentTarget.offsetLeft) - game.leftTank.gunpointX,
                    );
                    setAngle(curAngle);
                }}
                onWheel={(e) => gameRef.current?.changeTankPower(e.deltaY > 0 ? -1 : 1)}
                onMouseLeave={() => {
                    const game = gameRef.current;
                    if (game?.isAngleMode) game.activateMode('idle');
                }}
                onClick={() => {
                    if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                    }
                    fireSelectedWeapon();
                }}
            />
            {botBubble && (
                <ChatBubble
                    reply={botBubble.reply}
                    x={botBubble.x}
                    y={botBubble.y}
                    onExpire={() => setBotBubble(null)}
                />
            )}
        </>
    );
}
