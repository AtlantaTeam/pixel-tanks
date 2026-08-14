'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { SkyBackground } from '../sky-background';
import { PrecipitationLayer } from '../precipitation-layer';
import { WindDustLayer } from '../wind-dust-layer';
import { floor } from '@/shared/lib/canvas';
import { createSeededRandom } from '@/shared/lib/random';
import { WEAPON_KIND_ORDER, type TWeapon } from '@/shared/model';
import { ChatBubble, type TBotReply } from '@/entities/bot-messages';
import { getStoredTankSkinId, selectTankSkinForSeed } from '@/entities/tank-skins';
import { selectIsBotTurn, useGameStore, type TSide } from '../../model/game.store';
import { GamePlay } from '../../lib/game-play';
import { DamageNumber, type TDamageHit } from '../damage-number';
import { dealWeapons } from '../../lib/weapons';
import { createFxRandom } from '../../lib/fx-random';
import { calculateDragAim } from '../../lib/drag-aim';
import { installGameDebugHook, uninstallGameDebugHook } from '../../lib/game-debug';
import {
    calculateGestureAim,
    clampBubbleAnchorY,
    isPointInGestureZone,
    isValidGestureZone,
    type TGestureZone,
} from '../../lib/gesture-aim';
import { attachGestureGuard } from '../../lib/gesture-guard';
import { resolveKeyboardIntent } from '../../lib/keyboard-scheme';
import { markAimHintSeen, useAimHintSeen } from '../../lib/aim-hint';
import { GestureOverlay, type TGestureVisual } from '../gesture-overlay';
import { AimHint, AimHintAnnouncer } from '../aim-hint';

type TDragState = {
    pointerId: number;
    startX: number;
    startY: number;
    /** Левый/верхний угол контейнера канваса — клиентские координаты → локальные. */
    containerLeft: number;
    containerTop: number;
};

/**
 * Приблизительная высота чат-бабла бота (шапка «skull + имя» + 1–2 строки текста +
 * паддинги + хвост) — для клэмпа `clampBubbleAnchorY`: точная высота зависит от
 * длины конкретной реплики, оценка держит бабл выше верхнего HUD с запасом, а не
 * впритык.
 */
const BUBBLE_HEIGHT_ESTIMATE = 100;

/**
 * Инсеты зоны жеста по брейкпоинтам (Tailwind arbitrary values) — единственный
 * источник правды геометрии зоны: от неё зависят гейт старта оттяжки
 * (`isPointInGestureZone`) и клэмп бабла (`clampBubbleAnchorY`).
 *
 * Значения повторяют фактические высоты `TopHud` (верхний инсет) и палубы
 * `GameControls` (нижний) на каждом брейкпоинте: <768 — 242/196, ≥768 (md) —
 * 128/168, ≥992 (lg) — 128/124, ≥1200 (xl) — 98/124 (на xl полосы фиксированы:
 * HUD `xl:h-[78px]`, дека `xl:h-[124px]`).
 *
 * Верхний инсет считается от ФАКТИЧЕСКОГО низа `top-hud`, а не от высоты самой
 * полосы (#557): обёртка HUD несёт внешний паддинг `p-2.5` (+10px сверху и
 * снизу), поэтому на xl низ панели — 98px (78 + 20), а не 78. Раньше инсет
 * брал только полосу, и верхние 20px зоны прицеливания лежали под панелью.
 * По той же причине lg-диапазон (992–1199) больше не переключается на
 * xl-значение: полоса там ещё в двухрядном md-составе (~122px), и остаётся
 * md-инсет 128.
 *
 * Общими с версткой HUD/деки токенами их не сделать: на мобилке/планшете полосы
 * content-sized — фиксированного числа, на которое можно сослаться, у них нет.
 * Поэтому — одна документированная константа и правило:
 * ⚠️ меняешь высоту `TopHud`/`GameControls` (включая паддинги обёрток) — правь
 * эти инсеты (и верхний инсет `AimHint`, привязанный к тем же брейкпоинтам).
 * Расхождение ловит e2e `gesture-zone-hud-budget.spec.ts` (низ HUD vs верх зоны
 * на всех вьюпортах); прежние e2e ловили лишь горизонтальный overflow и
 * видимость лока, но НЕ вертикальное выравнивание зоны.
 */
const GESTURE_ZONE_INSET =
    'top-[242px] right-[10px] bottom-[196px] left-[10px] md:top-[128px] md:bottom-[168px] lg:bottom-[124px] xl:top-[98px]';

type TGameCanvasProps = {
    seed?: number | string;
};

/**
 * Императивный API движка для внешних контролов (палуба, `widgets/game-controls`):
 * манёвр и выстрел живут на инстансе `GamePlay` внутри канваса, стор их не хранит
 * (см. `commitPlayerShot`/`changeTankPosition`) — кнопкам палубы нужен способ их
 * дёрнуть, не дублируя доступ к движку снаружи.
 */
export type TGameCanvasHandle = {
    fire: () => void;
    moveLeft: () => void;
    moveRight: () => void;
};

/**
 * Единый путь выстрела игрока: запись хода в реплей (`recordFire` заодно считает
 * выстрел для статистики), выстрел движка, расход оружия. Один helper на обе схемы
 * ввода — клавиатуру и мышь/тач: правка выстрела не должна расходиться по копиям.
 */
function commitPlayerShot(
    game: GamePlay,
    weapon: TWeapon,
    recordFire: (angle: number, power: number, weaponId?: number) => void,
    removeWeaponById: (id: number) => void,
) {
    if (!game.leftTank) return;
    // Тип оружия в реплей — ординал по `WEAPON_KIND_ORDER` (issue #483): кратер по
    // типу меняет рельеф, без записи типа воспроизведение разошлось бы с боем.
    // Клампим ординал в источнике: `indexOf` вернёт -1 для kind вне порядка (не
    // должен возникать, но `EWeaponKind` не тотален по построению), а -1 просочился
    // бы в реплей и уронил бы кодек в конце боя. Неизвестный тип → фугас (0).
    const weaponOrdinal = Math.max(0, WEAPON_KIND_ORDER.indexOf(weapon.kind));
    recordFire(game.leftTank.gunpointAngle, game.leftTank.power, weaponOrdinal);
    game.onFire(weapon);
    removeWeaponById(weapon.id);
}

export const GameCanvas = forwardRef<TGameCanvasHandle, TGameCanvasProps>(function GameCanvas(
    { seed }: TGameCanvasProps,
    ref,
) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const zoneRef = useRef<HTMLDivElement>(null);
    const gameRef = useRef<GamePlay | null>(null);
    const dragRef = useRef<TDragState | null>(null);
    // После тач-жеста браузер шлёт синтетический click — глотаем его,
    // чтобы тап/оттяжка не приводили к повторному выстрелу мышиной схемой.
    const suppressClickRef = useRef(false);

    // Сид боя фиксируем один раз на монтирование: тот же сид получают и движок
    // (рельеф/ветер/бот), и фоновое небо (`SkyBackground`) — пресет и стартовое
    // положение облаков совпадают с боем. Без seed-пропа — случайный бой (Date.now).
    const [battleSeed] = useState<number | string>(() => seed ?? Date.now());
    // Скины танков (issue #481): свой — из сохранённого предпочтения (читается
    // один раз на старте боя, как и battleSeed — смена скина в настройках
    // подхватится следующим боем), бот — детерминированно от сида боя, чтобы
    // тот же сид давал тот же вид соперника и в реплее.
    const [leftSkinId] = useState(() => getStoredTankSkinId());
    // Бот — из палитр, отличных от палитры игрока, чтобы цвета «свой/чужой» не
    // сливались (см. `selectTankSkinForSeed`); детерминированно от сида боя.
    const [rightSkinId] = useState(() => selectTankSkinForSeed(battleSeed, leftSkinId));

    const [botBubble, setBotBubble] = useState<{ reply: TBotReply; x: number; y: number } | null>(
        null,
    );
    // Число урона над задетым танком (issue #549) — местное состояние (как
    // botBubble): само событие происходит здесь же, в GameCanvas, кросс-дерева
    // (верхний HUD) сигналит только `lastHit` в сторе (см. `recordHit`).
    const [damageNumber, setDamageNumber] = useState<TDamageHit | null>(null);
    // Визуал жеста (луч, кольцо) — обновляется на pointermove, живёт в DOM-оверлее.
    const [gestureVisual, setGestureVisual] = useState<TGestureVisual | null>(null);
    // Разовая подсказка прицеливания (#565): показана один раз, факт «видел»
    // переживает перезагрузку (localStorage). Раньше обучающие строки висели в чипе
    // на каждом жесте каждого боя.
    const aimHintSeen = useAimHintSeen();

    const angle = useGameStore((s) => s.angle);
    const power = useGameStore((s) => s.power);
    const arenaInsets = useGameStore((s) => s.arenaInsets);
    const moves = useGameStore((s) => s.moves);
    const selectedWeapon = useGameStore((s) => s.selectedWeapon);
    // Ветер боя — небу: облака плывут по нему, а не всегда вправо (#518). Значение
    // постоянно весь бой (`generateWind` на старте), поэтому сцена не пересоздаётся.
    const wind = useGameStore((s) => s.wind);
    const weapons = useGameStore((s) => s.weapons);

    const setAngle = useGameStore((s) => s.setAngle);
    const setPower = useGameStore((s) => s.setPower);
    const increasePower = useGameStore((s) => s.increasePower);
    const increaseAngle = useGameStore((s) => s.increaseAngle);
    const decrementMoves = useGameStore((s) => s.decrementMoves);
    const applyDamage = useGameStore((s) => s.applyDamage);
    const recordHit = useGameStore((s) => s.recordHit);
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
    const announceWindShift = useGameStore((s) => s.announceWindShift);
    const setPhase = useGameStore((s) => s.setPhase);
    const fireStore = useGameStore((s) => s.fire);
    const turn = useGameStore((s) => s.turn);
    const phase = useGameStore((s) => s.phase);
    // Ход бота (handoff «Ход бота»): арена в маджента-рамке весь ход соперника —
    // включая его собственный полёт снаряда (turn не флипается обратно, пока
    // снаряд бота не долетит, см. `changeActiveTank`). Бой окончен — рамки нет,
    // финал закрывает GameOverDialog.
    const isBotTurn = selectIsBotTurn({ turn, phase });
    // Разовая подсказка активна: не видена, не ход бота, бой не окончен. Один
    // источник для визуальной плашки `AimHint` и всегда-смонтированного
    // `AimHintAnnouncer` — визуал и анонс не должны разъехаться по условию.
    const aimHintActive = !aimHintSeen && !isBotTurn && !isGameOver;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Фазовая машина верхнего HUD (handoff «Состояние») — старт боя ДО
        // setBattleSeed/setWeapons ниже: startGame сбрасывает battleSeed/battleField
        // в null, следующие строки тут же наполняют их заново.
        startGame();
        // Размер бэкинг-стора canvas (dpr, resize) полностью на стороне GamePlay.fit().
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
                onTankHit: ({ hittedIsLeft, leftActive, power, x, y }) => {
                    const target: TSide = hittedIsLeft ? 'player' : 'enemy';
                    applyDamage(target, power);
                    // Число урона в месте события (#549) + сигнал верхнему HUD
                    // (вспышка HP-полосы задетой стороны, `top-hud.tsx`).
                    setDamageNumber({ target, amount: power, x, y });
                    recordHit(target);
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
                    // Клэмп по зоне жеста (handoff: бабл «не заходит в полосы HUD») —
                    // та же зона, что и у чипа прицела, её верхняя граница совпадает с
                    // низом верхнего оверлея на любом брейкпоинте.
                    const rawY = bot.y - bot.tankHeight;
                    const containerRect = canvasRef.current?.getBoundingClientRect();
                    const zoneRect = zoneRef.current?.getBoundingClientRect();
                    const y =
                        containerRect && zoneRect
                            ? clampBubbleAnchorY(
                                  rawY,
                                  {
                                      top: zoneRect.top - containerRect.top,
                                      bottom: zoneRect.bottom - containerRect.top,
                                      left: zoneRect.left - containerRect.left,
                                      right: zoneRect.right - containerRect.left,
                                  },
                                  BUBBLE_HEIGHT_ESTIMATE,
                              )
                            : rawY;
                    setBotBubble({
                        reply,
                        x: bot.x + bot.tankWidth / 2,
                        y,
                    });
                },
                // Логический размер поля и инсеты safe-зоны этого боя — пишем в
                // реплей вместе с seed: рельеф генерится внутри зоны, без инсетов
                // воспроизведение получит другой рельеф (#454).
                onFieldInit: ({ width, height, insets }) => setBattleField(width, height, insets),
                // Верхний HUD (handoff «Состояние»): ветер — один раз при старте
                // боя, ход и лок ввода — на каждой передаче/выстреле.
                onWindInit: (wind) => setWind(wind),
                // Буря сменила ветер в середине боя (#547): обновляем значение в HUD
                // и поднимаем плашку «ветер изменился» — смена обязана быть видимой,
                // иначе читается как баг (§7.8).
                onWindChange: (wind) => {
                    setWind(wind);
                    announceWindShift();
                },
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
            // Сид боя — модели света сцены (#545): тот же сид, что у неба
            // (`SkyBackground`), поэтому тень/тонировка согласованы с диском светила.
            { leftSkinId, rightSkinId, seed: battleSeed },
        );
        gameRef.current = game;
        game.loadImages();
        // Read-only e2e-хук (issue #456): барьер safe-зоны/пропорций читает
        // прямоугольники корпуса танков через window.__gameDebug — у канваса
        // нет DOM-узла на танк, который снял бы Playwright boundingBox().
        installGameDebugHook(() => gameRef.current);

        return () => {
            game.destroy();
            gameRef.current = null;
            uninstallGameDebugHook();
            resetGame();
            setBotBubble(null);
            setDamageNumber(null);
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

    // Подпись у ствола (hover мышью, #565) гаснет при выстреле: снаряд в полёте —
    // целиться нечем, значения угла уже ни на что не влияют.
    useEffect(() => {
        if (phase === 'flight') {
            gameRef.current?.setBarrelReadoutVisible(false);
        }
    }, [phase]);

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

    // Инсеты арены → движок (контракт safe-зоны, #453): оверлеи публикуют свои
    // высоты в стор (`useArenaInset`), движок хранит производную свободную зону.
    // Тот же паттерн store→engine, что и синк угла/мощности выше: React-состояние
    // не участвует в кадровом цикле, движок держит зону в поле `arenaZone`. Рельеф
    // при этом выводит свою полосу из тех же инсетов напрямую (`computeTerrainHeights`
    // в `Ground`, #454), а клэмпы жеста/пузыря — из DOM-узла `zoneRef` ниже.
    useEffect(() => {
        gameRef.current?.setArenaInsets(arenaInsets);
    }, [arenaInsets]);

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
                        // Клавиатурный выстрел тоже гасит разовую подсказку (#565).
                        markAimHintSeen();
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
        // Первый реальный выстрел игрока гасит разовую подсказку (#565) — независимо
        // от схемы ввода (тач-отпускание и десктоп-клик оба идут сюда). Идемпотентно.
        markAimHintSeen();
        commitPlayerShot(game, selectedWeapon, recordFire, removeWeaponById);
    };

    /** Тот же гард, что у клавиатурного манёвра (`move-left`/`move-right`) — палуба
     *  (`widgets/game-controls`) зовёт его через `TGameCanvasHandle`, дублировать
     *  условие в кнопках снаружи движка нельзя (разъедется с клавиатурой). */
    const moveTank = (delta: number) => {
        const game = gameRef.current;
        // Гард по isActive — как у клавиатурного манёвра (onKeyDown стартует с
        // `!game?.leftTank?.isActive` return) и выстрела (`fireSelectedWeapon`):
        // без него вызов на ходе бота сдвинул бы активный (правый, бот) танк и
        // записал ложный ход в реплей. Сейчас это маскируют disabled-кнопки
        // палубы, но гард обязан жить в движке, а не только в разметке снаружи.
        if (
            !game ||
            game.isOver ||
            !game.leftTank?.isActive ||
            game.isFireMode ||
            game.isMoveMode ||
            moves <= 0
        )
            return;
        game.changeTankPosition(delta);
        recordMove(delta);
    };

    useImperativeHandle(
        ref,
        () => ({
            fire: fireSelectedWeapon,
            moveLeft: () => moveTank(-150),
            moveRight: () => moveTank(150),
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selectedWeapon, moves, recordFire, removeWeaponById, recordMove],
    );

    return (
        <div className="relative h-full w-full">
            {/* Слоистое небо под рельефом (#479): отдельный канвас за игровым.
                Игровой канвас прозрачен (`clearRect` открывает это небо вместо
                чёрного фона), поэтому `bg-bg` с него снят. */}
            <SkyBackground seed={battleSeed} wind={wind} className="absolute inset-0" />
            <canvas
                ref={canvasRef}
                // Точка входа e2e к состоянию движка: `GamePlay.activateMode` пишет сюда
                // `data-engine-mode` на каждом переходе, и тесты ждут выхода из стартового
                // `fire` по сигналу, а не по таймеру.
                data-testid="game-canvas"
                className="game-canvas relative block h-full w-full touch-none"
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
                    const containerRect = e.currentTarget.getBoundingClientRect();
                    const zoneRect = zoneRef.current?.getBoundingClientRect();
                    const measured: TGestureZone | null = zoneRect
                        ? {
                              top: zoneRect.top,
                              bottom: zoneRect.bottom,
                              left: zoneRect.left,
                              right: zoneRect.right,
                          }
                        : null;
                    // Вырожденную зону (короткий landscape: оверлеи перекрылись) не
                    // применяем — гейт fail-open, иначе целиться нельзя вовсе.
                    const zone = measured && isValidGestureZone(measured) ? measured : null;
                    // Оттяжку можно начинать только внутри зоны жеста (handoff):
                    // старт на элементах HUD/палубе прицеливание не начинает.
                    if (zone && !isPointInGestureZone({ x: e.clientX, y: e.clientY }, zone)) return;
                    dragRef.current = {
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        startY: e.clientY,
                        containerLeft: containerRect.left,
                        containerTop: containerRect.top,
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
                    const aim = calculateGestureAim(
                        { x: drag.startX, y: drag.startY },
                        { x: e.clientX, y: e.clientY },
                    );
                    if (!aim) return;
                    // При превышении максимума сила уже зафиксирована на POWER_MAX
                    // внутри calculateGestureAim (клэмп) — в стор уходит то же значение.
                    setAngle(aim.angle);
                    setPower(aim.power);
                    // Локальные координаты оверлея = клиентские минус угол контейнера.
                    const originX = drag.startX - drag.containerLeft;
                    const originY = drag.startY - drag.containerTop;
                    const fingerX = e.clientX - drag.containerLeft;
                    const fingerY = e.clientY - drag.containerTop;
                    setGestureVisual({
                        originX,
                        originY,
                        fingerX,
                        fingerY,
                        angle: aim.angle,
                        power: aim.power,
                        isMax: aim.isMax,
                    });
                }}
                onPointerUp={(e) => {
                    const drag = dragRef.current;
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    dragRef.current = null;
                    setGestureVisual(null);
                    suppressClickRef.current = true;
                    const game = gameRef.current;
                    game?.setAimPreviewVisible(false);
                    // Гибрид (мышь+тач), как в onPointerCancel: предшествующий hover мог
                    // оставить `showBarrelReadout=true`. Тап без оттяжки (`calculateDragAim`
                    // вернёт null — ранний выход ниже) не проходит через phase→flight,
                    // который гасит readout, поэтому сбрасываем его здесь явно — иначе
                    // canvas-подпись зависнет до следующего mousemove/mouseleave/выстрела.
                    game?.setBarrelReadoutVisible(false);
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
                    setGestureVisual(null);
                    const game = gameRef.current;
                    game?.setAimPreviewVisible(false);
                    // Гибрид (мышь+тач): до жеста мог быть hover с `showBarrelReadout=true`.
                    // Отменённый жест (не завершён выстрелом) не проходит через phase→flight,
                    // поэтому readout гасим здесь явно — иначе canvas-подпись висит до
                    // следующего mousemove/mouseleave/выстрела.
                    game?.setBarrelReadoutVisible(false);
                }}
                onMouseMove={(e) => {
                    const game = gameRef.current;
                    if (!game || !game.leftTank?.isActive || !game.ctx) return;

                    const curAngle = Math.atan2(
                        floor(e.clientY - e.currentTarget.offsetTop) - game.leftTank.gunpointY,
                        floor(e.clientX - e.currentTarget.offsetLeft) - game.leftTank.gunpointX,
                    );

                    if (!game.isFireMode) {
                        setAngle(curAngle);
                    }

                    // Подпись «угол·сила» у ствола при наведении мышью (#565): та же
                    // canvas-подпись, что при жесте, только без дуги (движок рисует её
                    // при `showBarrelReadout`). Прежде это был DOM-чип, висевший в небе
                    // над стволом; теперь подпись прилипла к стволу. Во время выстрела
                    // (снаряд в полёте) целиться нечем — подпись гасим.
                    game.setBarrelReadoutVisible(!game.isFireMode);
                }}
                onWheel={(e) => gameRef.current?.changeTankPower(e.deltaY > 0 ? -1 : 1)}
                onMouseLeave={() => {
                    const game = gameRef.current;
                    if (game?.isAngleMode) game.activateMode('idle');
                    game?.setBarrelReadoutVisible(false);
                }}
                onClick={() => {
                    if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                    }
                    fireSelectedWeapon();
                }}
            />
            {/* Ветровые пылинки приземного слоя (#550): «дешёвый носитель» ветра рядом с
                ареной, не только цифра в HUD. Под осадками — дождь/снег ложится поверх. */}
            <WindDustLayer seed={battleSeed} wind={wind} className="absolute inset-0" />
            {/* Осадки как погодный пресет (#546): слой над ареной, но под UI-оверлеями
                (жест, чип, бабл). Гаснут при активной оттяжке — тем же сигналом
                `gestureVisual !== null`, что и чат-бабл (#527). При reduced-motion слой
                частиц не рисует; погоду тогда несёт тонировка рельефа (`GamePlay`). */}
            <PrecipitationLayer
                seed={battleSeed}
                wind={wind}
                dimmed={gestureVisual !== null}
                className="absolute inset-0"
            />
            {/* Зона жеста (handoff): между верхним оверлеем и палубой. Всегда в DOM —
                замеряется на старте оттяжки (гейт старта). Инсеты по брейкпоинтам —
                в `GESTURE_ZONE_INSET` (там же правило синхронизации с высотами HUD/деки). */}
            <div
                ref={zoneRef}
                data-testid="gesture-zone"
                aria-hidden
                className={`pointer-events-none absolute ${GESTURE_ZONE_INSET}`}
            />
            {/* Разовая подсказка прицеливания (#565) у верха зоны — показана один раз,
                гаснет после первого выстрела и не воскресает (localStorage). Не
                показываем на ходе бота и после конца боя. Факт для скринридера несёт
                отдельный, всегда смонтированный `AimHintAnnouncer` (a11y, ревью #574):
                live-region обязан быть в дереве ДО появления текста, поэтому он не
                внутри условной плашки. */}
            <AimHint visible={aimHintActive} />
            <AimHintAnnouncer active={aimHintActive} />
            <GestureOverlay visual={gestureVisual} />
            {/* Ход бота (handoff): маджента-рамка арены — без предсказания траектории,
                игрок не должен заранее знать, попадёт ли соперник. */}
            {isBotTurn && (
                <div
                    data-testid="arena-turn-ring"
                    aria-hidden
                    className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_3px_var(--color-enemy),inset_0_0_40px_rgba(201,0,255,.28)]"
                />
            )}
            {botBubble && (
                <ChatBubble
                    reply={botBubble.reply}
                    x={botBubble.x}
                    y={botBubble.y}
                    // Пока игрок тянет рогатку, реплика гаснет: на телефоне она
                    // накрывала половину арены ровно в момент прицеливания (#527).
                    // Именно гаснет, а не размонтируется — таймер жизни продолжает идти.
                    dimmed={gestureVisual !== null}
                    onExpire={() => setBotBubble(null)}
                />
            )}
            {damageNumber && (
                <DamageNumber
                    // Ключ по координатам и урону попадания: без него повторный хит в
                    // живом инстансе не перезапустил бы CSS-анимацию всплытия — число
                    // молча повисло бы на прежней фазе. Тот же приём, что `key={nonce}`
                    // у трека HP и плашки смены ветра.
                    key={`${damageNumber.x}:${damageNumber.y}:${damageNumber.amount}`}
                    hit={damageNumber}
                    onExpire={() => setDamageNumber(null)}
                />
            )}
        </div>
    );
});
