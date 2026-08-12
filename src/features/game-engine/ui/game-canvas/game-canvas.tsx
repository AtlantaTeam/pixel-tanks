'use client';

import { useEffect, useRef, useState } from 'react';
import { floor } from '@/shared/lib/canvas';
import { createSeededRandom } from '@/shared/lib/random';
import type { TWeapon } from '@/shared/model';
import { ChatBubble, type TBotReply } from '@/entities/bot-messages';
import { useGameStore } from '../../model/game.store';
import { GamePlay } from '../../lib/game-play';
import { dealWeapons } from '../../lib/weapons';
import { createFxRandom } from '../../lib/fx-random';
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

/**
 * Единый путь выстрела игрока: запись хода в реплей (`recordFire` заодно считает
 * выстрел для статистики), выстрел движка, расход оружия. Один helper на обе схемы
 * ввода — клавиатуру и мышь/тач: правка выстрела не должна расходиться по копиям.
 */
function commitPlayerShot(
    game: GamePlay,
    weapon: TWeapon,
    recordFire: (angle: number, power: number) => void,
    removeWeaponById: (id: number) => void,
) {
    if (!game.leftTank) return;
    recordFire(game.leftTank.gunpointAngle, game.leftTank.power);
    game.onFire(weapon);
    removeWeaponById(weapon.id);
}

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
    const applyDamage = useGameStore((s) => s.applyDamage);
    const recordPlayerHit = useGameStore((s) => s.recordPlayerHit);
    const isGameOver = useGameStore((s) => s.isGameOver);
    const setWeapons = useGameStore((s) => s.setWeapons);
    const selectWeapon = useGameStore((s) => s.selectWeapon);
    const removeWeaponById = useGameStore((s) => s.removeWeaponById);
    const setGameOver = useGameStore((s) => s.setGameOver);
    const startGame = useGameStore((s) => s.startGame);
    const resetGame = useGameStore((s) => s.resetGame);
    const setBattleSeed = useGameStore((s) => s.setBattleSeed);
    const setBattleField = useGameStore((s) => s.setBattleField);
    const recordMove = useGameStore((s) => s.recordMove);
    const recordFire = useGameStore((s) => s.recordFire);
    const setTurn = useGameStore((s) => s.setTurn);
    const setWind = useGameStore((s) => s.setWind);
    const setPhase = useGameStore((s) => s.setPhase);
    const fireStore = useGameStore((s) => s.fire);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Фазовая машина верхнего HUD (handoff «Состояние») — старт боя ДО
        // setBattleSeed/setWeapons ниже: startGame сбрасывает battleSeed/battleField
        // в null, следующие строки тут же наполняют их заново.
        startGame();
        // Размер бэкинг-стора canvas (dpr, resize) полностью на стороне GamePlay.fit().
        const battleSeed = seed ?? Date.now();
        setBattleSeed(battleSeed);
        const allWeapons = dealWeapons();
        setWeapons(allWeapons.leftTankWeapons);
        selectWeapon(allWeapons.leftTankWeapons[0]);

        const game = new GamePlay(
            canvasRef,
            allWeapons,
            {
                // Попадание снимает урон оружия с HP того танка, в который попали
                // (HP-модель, GDD §2.5): левый танк — игрок, правый — бот.
                onTankHit: ({ hittedIsLeft, leftActive, power }) => {
                    applyDamage(hittedIsLeft ? 'player' : 'enemy', power);
                    // Попадание игрока по противнику — для точности game-over.
                    // leftActive → стрелял игрок; !hittedIsLeft → задет бот (не самострел).
                    if (leftActive && !hittedIsLeft) recordPlayerHit();
                },
                onGameOverCheck: ({ leftWeapons, rightWeapons }) => {
                    if (!leftWeapons && !rightWeapons && !game.isFireMode) {
                        setGameOver();
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
                // Логический размер поля этого боя — пишем в реплей вместе с seed.
                onFieldInit: ({ width, height }) => setBattleField(width, height),
                // Верхний HUD (handoff «Состояние»): ветер — один раз при старте
                // боя, ход и лок ввода — на каждой передаче/выстреле.
                onWindInit: (wind) => setWind(wind),
                onTurnChange: (turn) => setTurn(turn),
                // fireStore сама решает, раскрывать ли ветер (только из aiming,
                // см. game.store.fire) — тот же вызов годится и для игрока, и для
                // бота: у обоих выстрел — это переход aiming → flight.
                onShotStart: () => fireStore(),
                onShotEnd: () => setPhase('aiming'),
            },
            createSeededRandom(battleSeed),
            // Отдельный поток для косметики (частицы, тряска): их FPS-зависимое
            // потребление random не должно сдвигать выборки бота (см. GamePlay).
            createFxRandom(battleSeed),
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

    // Конец боя по HP наступает при живых арсеналах (добивание), о чём движок сам
    // не знает — замораживаем его по isGameOver стора: rAF-цикл встаёт (бот не
    // дострелит «в труп»), а ввод гасится по game.isOver ниже. Иначе бой продолжался
    // бы за открытой модалкой и писал пост-смертные ходы в реплей.
    useEffect(() => {
        if (isGameOver) gameRef.current?.stop();
    }, [isGameOver]);

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
            // Бой окончен (движок заморожен по isGameOver) — ввод игнорируем,
            // иначе выстрел/манёвр за модалкой допишет пост-смертный ход в реплей.
            if (game.isOver) return;
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
                    // И не стреляем, пока танк доезжает после перемещения
                    // (isMoveMode / dx ≠ 0): снаряд иначе родится из промежуточной
                    // позиции, а реплей применяет выстрел из конечной — счёт разойдётся.
                    if (
                        selectedWeapon &&
                        !game.isFireMode &&
                        !game.isMoveMode &&
                        !game.leftTank.dx
                    ) {
                        commitPlayerShot(game, selectedWeapon, recordFire, removeWeaponById);
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
        // Не стреляем после конца боя (движок заморожен), в полёте снаряда и пока
        // танк доезжает после перемещения — иначе выстрел из промежуточной позиции
        // разойдётся с реплеем (см. keyboard fire).
        if (
            !game ||
            game.isOver ||
            !selectedWeapon ||
            game.isFireMode ||
            game.isMoveMode ||
            !game.leftTank?.isActive ||
            game.leftTank.dx
        )
            return;
        commitPlayerShot(game, selectedWeapon, recordFire, removeWeaponById);
    };

    return (
        <div className="relative h-full w-full">
            <canvas
                ref={canvasRef}
                className="game-canvas block h-full w-full touch-none bg-bg"
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
                    if (!game?.leftTank?.isActive || game.isFireMode || game.isOver) return;
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
        </div>
    );
}
