'use client';

import { useEffect, useRef } from 'react';
import type { TWeapon } from '@/shared/model';
import { floor } from '@/shared/lib/canvas';
import { createSeededRandom } from '@/shared/lib/random';
import { useGameStore } from '../../model/game.store';
import { GamePlay, type TTanksWeapons } from '../../lib/game-play';
import { Bullet } from '../../lib/bullet';
import { calculateDragAim } from '../../lib/drag-aim';

type TDragState = {
    pointerId: number;
    startX: number;
    startY: number;
};

const WEAPONS_AMOUNT = 10;

const generateRandomWeapons = (amount: number): TTanksWeapons => {
    const weapons: TWeapon[] = [];
    for (let i = 0; i < amount; i++) {
        weapons[i] = { id: i, name: Bullet.label };
    }
    return {
        leftTankWeapons: weapons.filter((_, index) => index % 2 === 0),
        rightTankWeapons: weapons.filter((_, index) => index % 2 === 1),
    };
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

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Размер бэкинг-стора canvas (dpr, resize) полностью на стороне GamePlay.fit().
        const allWeapons = generateRandomWeapons(WEAPONS_AMOUNT);
        setWeapons(allWeapons.leftTankWeapons);
        selectWeapon(allWeapons.leftTankWeapons[0]);

        const game = new GamePlay(
            canvasRef,
            allWeapons,
            {
                onPointsCalc: ({ hittedIsLeft, leftActive, power: hitPower }) => {
                    if (hittedIsLeft) {
                        if (leftActive) {
                            increasePlayerPoints(-hitPower);
                        } else {
                            increaseEnemyPoints(hitPower);
                        }
                    } else if (leftActive) {
                        increasePlayerPoints(hitPower);
                    } else {
                        increaseEnemyPoints(-hitPower);
                    }
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
            },
            createSeededRandom(seed ?? Date.now()),
        );
        gameRef.current = game;
        game.loadImages();

        return () => {
            game.destroy();
            gameRef.current = null;
            resetGame();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync store → engine (когда меняем угол/мощность через UI)
    useEffect(() => {
        const game = gameRef.current;
        if (!game?.leftTank || !game?.rightTank) return;
        const [activeTank] = game.getActiveAndTargetTanks(game.leftTank, game.rightTank);
        activeTank.power = power;
        if (activeTank.gunpointAngle !== angle) {
            game.activateMode('angle');
            activeTank.gunpointAngle = angle;
        }
    }, [angle, power]);

    // Управление клавиатурой
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const game = gameRef.current;
            if (!game?.leftTank?.isActive || !game.rightTank) return;
            if (
                e.key !== 'ArrowRight' &&
                e.key !== 'ArrowLeft' &&
                e.key !== 'ArrowUp' &&
                e.key !== 'ArrowDown' &&
                e.key !== ' '
            ) {
                return;
            }
            e.preventDefault();

            switch (e.key) {
                case 'ArrowDown':
                    if (e.ctrlKey && weapons.length > 0 && selectedWeapon) {
                        const idx = weapons.findIndex((w) => w.id === selectedWeapon.id);
                        const next = idx + 1 > weapons.length - 1 ? 0 : idx + 1;
                        selectWeapon(weapons[next]);
                    } else {
                        game.changeTankPower(-1);
                    }
                    break;
                case 'ArrowUp':
                    if (e.ctrlKey && weapons.length > 0 && selectedWeapon) {
                        const idx = weapons.findIndex((w) => w.id === selectedWeapon.id);
                        const prev = idx - 1 < 0 ? weapons.length - 1 : idx - 1;
                        selectWeapon(weapons[prev]);
                    } else {
                        game.changeTankPower(1);
                    }
                    break;
                case 'ArrowLeft':
                    if (e.ctrlKey) {
                        if (moves > 0 && !game.isMoveMode) game.changeTankPosition(-150);
                    } else {
                        increaseAngle(-Math.PI / 180);
                    }
                    break;
                case 'ArrowRight':
                    if (e.ctrlKey) {
                        if (moves > 0 && !game.isMoveMode) game.changeTankPosition(150);
                    } else {
                        increaseAngle(Math.PI / 180);
                    }
                    break;
                default:
                    if (selectedWeapon) {
                        game.onFire(selectedWeapon);
                        removeWeaponById(selectedWeapon.id);
                    }
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedWeapon, weapons, moves, selectWeapon, removeWeaponById, increaseAngle]);

    const fireSelectedWeapon = () => {
        const game = gameRef.current;
        if (!game || !selectedWeapon || game.isFireMode || !game.leftTank?.isActive) return;
        game.onFire(selectedWeapon);
        removeWeaponById(selectedWeapon.id);
    };

    return (
        <canvas
            ref={canvasRef}
            className="game-canvas block h-full w-full touch-none bg-base-200"
            onPointerDown={(e) => {
                // Мышь оставляем на своей схеме (движение — угол, клик — выстрел);
                // жест «оттяни и отпусти» — для touch/pen.
                if (e.pointerType === 'mouse') return;
                const game = gameRef.current;
                if (!game?.leftTank?.isActive || game.isFireMode) return;
                dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
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
                const [activeTank] = game.getActiveAndTargetTanks(game.leftTank, game.rightTank);
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
    );
}
