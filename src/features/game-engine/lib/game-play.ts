import type { RefObject } from 'react';
import { floor, getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import { getAudioEngine } from '@/shared/lib/audio';
import type { TSeededRandom } from '@/shared/lib/random';
import type { TCoords, TWeapon } from '@/shared/model';
import { pickBotReply, resolveBotReplyCategory, type TBotReply } from '@/entities/bot-messages';
import {
    DEFAULT_TANK_SKIN_ID,
    getTankSkinById,
    loadTankSkinImages,
    type TTankSkinId,
    type TTankSkinImages,
} from '@/entities/tank-skins';
import {
    computeArenaZone,
    EMPTY_ARENA_INSETS,
    type TArenaInsets,
    type TArenaZone,
} from './arena-insets';
import { Ground } from './ground';
import { Tank } from './tank';
import { Bullet } from './bullet';
import { generateWind } from './wind';
import { BULLET_GRAVITY, fillTrajectoryPreview, TRAJECTORY_PREVIEW_POINTS } from './bullet-physics';
import { formatAngle } from './format-angle';
import { ParticlePool, damageFlashBurst, groundBurst } from './particle-pool';
import { CameraShake } from './camera-shake';
import { SlowMotion } from './slow-motion';
import { BulletTrail } from './bullet-trail';
import { ENGINE_COLORS } from './engine-palette';
import { computeWorldScale, WORLD_UNITS } from './world-scale';

/** Ёмкости пула хватает на одновременный залп земли и вспышку урона. */
const PARTICLE_CAPACITY = 96;

/** Травма screen shake при промахе (взрыв по земле) — короткий толчок. */
const MISS_SHAKE_TRAUMA = 0.5;
/** Травма при прямом попадании в танк — заметно сильнее промаха. */
const HIT_SHAKE_TRAUMA = 0.85;
/** Запас очистки при сдвиге сцены во время тряски, CSS-пиксели. */
const SHAKE_CLEAR_PAD = 4;
/** Базовый интервал шага симуляции (~66 к/с). Slow-mo растягивает его. */
const BASE_FRAME_INTERVAL_MS = 15;

/**
 * Пунктир сегмента направления (handoff: `stroke-dasharray:6 8`). Модульные
 * константы, а не литералы в кадре: `ctx.setLineDash` копирует массив, поэтому
 * переиспользуем один и тот же — никаких аллокаций в кадре (`.claude/rules/canvas.md`).
 */
const SEGMENT_DASH: readonly number[] = [6, 8];
const NO_DASH: readonly number[] = [];
/** Прозрачность у ствола (handoff: `opacity:.85`) — дуга затухает к концу от неё. */
const SEGMENT_OPACITY = 0.85;
/**
 * Дуга предпросмотра гаснет к концу: последний сегмент получает эту долю базовой
 * прозрачности (issue #475 «затухающая к концу»). Не в ноль — иначе хвост дуги
 * исчезает рывком.
 */
const ARC_TAIL_OPACITY_FACTOR = 0.12;
/** Скорость бегущего пунктира дуги (px/мс). Гасится при prefers-reduced-motion. */
const ARC_DASH_SPEED = 0.04;
/** Толщина индикатора «угол·сила» у ствола и его отступ вверх от точки крепления. */
const BARREL_LABEL_FONT = '700 13px "JetBrains Mono", ui-monospace, monospace';
const BARREL_LABEL_OFFSET = 16;

export type TTanksWeapons = {
    leftTankWeapons: TWeapon[];
    rightTankWeapons: TWeapon[];
};

export type TGameMode = 'idle' | 'fire' | 'angle' | 'move';

export type TGamePlayCallbacks = {
    /** Попадание снаряда в танк: снимает урон с HP задетой стороны (HP-модель, §2.5). */
    onTankHit: (params: { hittedIsLeft: boolean; leftActive: boolean; power: number }) => void;
    onGameOverCheck: (params: { leftWeapons: number; rightWeapons: number }) => void;
    onMovesChange: (delta: number) => void;
    onPowerChange: (delta: number) => void;
    onBotReply: (reply: TBotReply) => void;
    /**
     * Сообщает логический размер поля и инсеты safe-зоны, на которых стартовал бой
     * (CSS-пиксели). Живой бой пишет их в реплей — без размера И инсетов
     * воспроизведение получит другой рельеф (рельеф генерится внутри свободной
     * зоны, #454) и другой счёт (см. `@/entities/replays`). Инсеты — те, что были
     * активны в момент генерации рельефа: фидельность реплея гарантирована тем, что
     * записаны ровно они.
     */
    onFieldInit?: (size: { width: number; height: number; insets: TArenaInsets }) => void;
    /**
     * Сообщает ветер боя (px/тик², как `this.wind`) сразу после генерации при
     * старте боя — верхний HUD (ячейка ВЕТЕР, handoff «Состояние») держит его
     * в сторе, а не читает движок напрямую.
     */
    onWindInit?: (wind: number) => void;
    /**
     * Сообщает сторону, чей сейчас ход: один раз при старте боя (игрок всегда
     * первый) и на каждой передаче хода (`changeActiveTank`). Пилюля хода и
     * заморозка телеметрии на ходе бота (handoff «Состояние») читают это из
     * стора, а не гадают по `isFireMode`/`isActive` движка.
     */
    onTurnChange?: (turn: 'player' | 'enemy') => void;
    /**
     * Снаряд создан и полетел (`fire()`, и для игрока, и для бота) — HUD лочит
     * ввод и подписывает пилюлю «ВЫСТРЕЛ» (handoff «Лок ввода»).
     */
    onShotStart?: () => void;
    /**
     * Взрыв доигран, снаряд убран, ход передан (`moveBullet`) — HUD снимает
     * лок «ВЫСТРЕЛ». На добивании (isGameOver) этот колбэк не срабатывает:
     * движок замораживается раньше (см. `GameCanvas`, isOver), сцена застывает
     * на кадре добивания под модалкой — счёт остаётся честным «конец боя»,
     * а не мигает обратно в «аим».
     */
    onShotEnd?: () => void;
};

/** Опции движка. `fixedLogicalSize` включает режим воспроизведения реплея. */
export type TGamePlayOptions = {
    /**
     * Фиксированный логический размер поля. Задан → движок ведёт всю физику в
     * этих пикселях независимо от размера canvas на экране (canvas вписывается
     * CSS-масштабированием), а resize не пересчитывает мир. Так реплей
     * воспроизводится один в один на любом устройстве.
     */
    fixedLogicalSize?: { width: number; height: number };
    /**
     * Скины танков (issue #481) — чисто отрисовочный выбор, на боевые параметры
     * не влияет (см. `tank-skin-parity.test.ts`). Левый — игрок (его выбор из
     * настроек), правый — бот (детерминированно от сида боя, `selectTankSkinForSeed`).
     * Не заданы → `DEFAULT_TANK_SKIN_ID` для обоих (совместимость с прежним
     * поведением/тестами, которые GamePlay без скинов не создавали).
     */
    leftSkinId?: TTankSkinId;
    rightSkinId?: TTankSkinId;
};

const GAME_ASSET_PATHS = {
    sand: '/game/sand.jpg',
};

export class GamePlay {
    private prevTimestamp = 0;
    ctx: CanvasRenderingContext2D | null | undefined;
    canvasRef: RefObject<HTMLCanvasElement | null>;
    static images: { [p: string]: HTMLImageElement } = {};
    innerWidth: number;
    innerHeight: number;
    /**
     * Инсеты оверлеев (HUD сверху, палуба снизу), которыми они закрывают арену
     * (контракт safe-зоны, issue #453). Публикует их стор боя (`arenaInsets`),
     * доносит `GameCanvas` через `setArenaInsets`. По умолчанию пусто — движок
     * ведёт себя как раньше (зона = весь канвас), пока оверлеи не сообщили высоту.
     */
    arenaInsets: TArenaInsets = EMPTY_ARENA_INSETS;
    /**
     * Свободная (не закрытая оверлеями) зона арены — производная от `innerHeight`
     * и `arenaInsets` (см. `computeArenaZone`). Хранится как поле и пересчитывается
     * на изменение любого входа: смену инсетов (`setArenaInsets` — брейкпоинт,
     * safe-area) и ресайз/поворот (`fit` меняет `innerHeight`) — это движковый
     * контракт safe-зоны (#453).
     *
     * **Отрисовка это поле пока не читает.** Фактические потребители зоны выводят её
     * себе сами, не через `arenaZone`: рельеф — из инсетов чистой `computeTerrainHeights`
     * (`Ground`, #454), а клэмпы жеста/пузыря — из DOM-узла `zoneRef` в `GameCanvas`
     * (там доступны реальные высоты сверстанных оверлеев). Поле держим как единый
     * движковый источник зоны на случай, когда рисование само начнёт из него исходить;
     * тесты (`game-play.test.ts`) фиксируют его пересчёт.
     */
    arenaZone: TArenaZone = { top: 0, height: 0 };
    mousePos: TCoords | null;
    maxGameDifficulty = 5;
    gameDifficulty = 1;
    ground: Ground | undefined;
    leftTank: Tank | undefined;
    rightTank: Tank | undefined;
    bullet: Bullet | undefined;
    isFireMode = true;
    isAngleMode = false;
    isMoveMode = false;
    /**
     * Бой заморожен: конец боя по HP наступает при живых арсеналах (добивание),
     * о чём движок сам не знает (его `onGameOverCheck` — только про пустое оружие).
     * `GameCanvas` подписан на `isGameOver` стора и зовёт `stop()` — иначе за
     * открытой модалкой бот продолжал бы стрелять «в труп», а ввод игрока писал бы
     * пост-смертные ходы в реплей. Гейтит и цикл rAF, и обработчики ввода.
     */
    isOver = false;
    /** Пунктирная линия прицела видна только во время оттяжки (тач-жест) */
    showAimPreview = false;
    private isImagesLoaded = false;
    allWeapons: TTanksWeapons;
    callbacks: TGamePlayCallbacks;
    private readonly audio = getAudioEngine();
    rafTimerId: number | undefined;
    private random: TSeededRandom;
    /** Режим воспроизведения: физика идёт в этом фиксированном размере. */
    private readonly fixedLogicalSize?: { width: number; height: number };
    // Скины танков (issue #481) — только отрисовка, `Tank` не знает о них вовсе
    // (принимает готовые `HTMLImageElement`). Картинки грузятся/кэшируются
    // отдельно от `GamePlay.images` (там только общий для всех боёв `sand`),
    // потому что скин выбирается за бой, а не глобально для всего приложения.
    private readonly leftSkinId: TTankSkinId;
    private readonly rightSkinId: TTankSkinId;
    private leftSkinImages: TTankSkinImages | undefined;
    private rightSkinImages: TTankSkinImages | undefined;
    // Кто стрелял последним: isActive у обоих танков уже false к моменту разрешения
    // выстрела бота (см. animate — rightTank.isActive гасится до botFire), поэтому
    // для определения самострела/адресата реплики шутер фиксируется явно в fire().
    private lastShooterIsLeft = true;
    wind = 0;
    private resizeObserver: ResizeObserver | undefined;
    private resizeRafId: number | undefined;
    // Пул частиц взрыва: комья земли (промах) и вспышка урона (попадание в танк).
    // Живёт весь бой, объекты переиспользуются — аллокаций в кадре нет.
    private readonly particles: ParticlePool;
    // Screen shake (тряска сцены) и slow-mo (замедление времени) — «сочность»
    // удара. Оба чистые, детерминированы seed'ом движка. Смещение применяется
    // в fullRedraw, масштаб времени — в throttle игрового цикла.
    private readonly camera: CameraShake;
    private readonly slowMo: SlowMotion;
    // Затухающий след снаряда: точки следа сами очищают свой прошлый прямоугольник
    // (см. bullet-trail.ts), поэтому полёт снаряда не требует fullRedraw каждый кадр.
    private readonly trail: BulletTrail;
    // Отметка последнего кадра rAF: реальный dt для затухания shake/slow-mo,
    // считается КАЖДЫЙ кадр (в т.ч. пропущенные throttle'ом).
    private lastFrameTs = 0;
    // Тряска была в прошлом кадре — чтобы один раз «доосадить» сцену в базовое
    // положение, когда дрожание закончилось (иначе остаётся суб-пиксельный сдвиг).
    private wasShaking = false;
    // Начало дуги предпросмотра (ствол) и её узлы: переиспользуются каждый кадр
    // драга вместо аллокации новых точек (правило .claude/rules/canvas.md).
    private readonly aimArcFrom: TCoords = { x: 0, y: 0 };
    private readonly aimArcPoints: TCoords[] = Array.from(
        { length: TRAJECTORY_PREVIEW_POINTS },
        () => ({ x: 0, y: 0 }),
    );
    /**
     * Снимок `prefers-reduced-motion` на бой (как `CameraShake`): при `reduce`
     * пунктир дуги предпросмотра статичен — без бегущей анимации (критерий #475).
     * Смену системной настройки в середине боя осознанно не слушаем (нет teardown).
     */
    private readonly reducedMotion: boolean =
        typeof window !== 'undefined'
            ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false;

    constructor(
        canvasRef: RefObject<HTMLCanvasElement | null>,
        allWeapons: TTanksWeapons,
        callbacks: TGamePlayCallbacks,
        random: TSeededRandom,
        fxRandom: TSeededRandom,
        options?: TGamePlayOptions,
    ) {
        this.random = random;
        this.fixedLogicalSize = options?.fixedLogicalSize;
        this.leftSkinId = options?.leftSkinId ?? DEFAULT_TANK_SKIN_ID;
        this.rightSkinId = options?.rightSkinId ?? DEFAULT_TANK_SKIN_ID;
        // Косметика (частицы, тряска) — на ОТДЕЛЬНОМ потоке random: CameraShake
        // берёт значения каждый кадр тряски, а число кадров зависит от FPS.
        // На общем потоке это недетерминированно сдвигало бы выборки бота
        // (botAiming) и ломало воспроизведение реплея на другой машине.
        this.particles = new ParticlePool(PARTICLE_CAPACITY, fxRandom);
        this.camera = new CameraShake(fxRandom);
        this.slowMo = new SlowMotion();
        this.trail = new BulletTrail();
        this.canvasRef = canvasRef;
        this.mousePos = null;
        this.allWeapons = allWeapons;
        this.callbacks = callbacks;
        if (this.fixedLogicalSize) {
            this.innerWidth = this.fixedLogicalSize.width;
            this.innerHeight = this.fixedLogicalSize.height;
        } else {
            const rect = canvasRef.current?.getBoundingClientRect() ?? { width: 1000, height: 700 };
            this.innerWidth = rect.width;
            this.innerHeight = rect.height;
        }
        this.recomputeArenaZone();
    }

    /**
     * Принимает инсеты оверлеев из стора (`GameCanvas` зовёт на каждой смене
     * `arenaInsets` — брейкпоинт, safe-area, фаза боя) и пересчитывает свободную
     * зону. Идемпотентна: те же инсеты дают ту же зону.
     *
     * **Рельеф намеренно НЕ перекладывается** на смену инсетов во время боя
     * (safe-зона, #454): рельеф генерится один раз в `initPaint` под инсеты,
     * активные тогда, и ровно они пишутся в реплей (`onFieldInit`). Перекладка на
     * лету рассинхронила бы живой бой с записью — нижний инсет штатно уменьшается
     * после первого выстрела (пропадает подсказка жеста, #451), палуба становится
     * ниже. Рельеф, сгенерированный под БОЛЬШИЙ стартовый инсет, при этом остаётся
     * выше укоротившейся палубы — танки видны, а запись воспроизводится один в один.
     * Инсеты приходят в движок до асинхронного `initPaint` (оверлеи публикуют их
     * синхронно на монтировании, спрайты грузятся сетью), поэтому рельеф рождается
     * уже в зоне без всякой перекладки.
     */
    setArenaInsets = (insets: TArenaInsets) => {
        this.arenaInsets = insets;
        this.recomputeArenaZone();
    };

    /** Пересчёт свободной зоны из текущих `innerHeight` и `arenaInsets`. */
    private recomputeArenaZone() {
        this.arenaZone = computeArenaZone(this.innerHeight, this.arenaInsets);
    }

    changeTankPosition = (delta: number) => {
        if (!this.leftTank || !this.rightTank || !this.leftTank.isActive) return;
        this.activateMode('move');
        const [activeTank] = this.getActiveAndTargetTanks(this.leftTank, this.rightTank);
        activeTank.dx = delta;
        this.callbacks.onMovesChange(-1);
    };

    // Управляется жестом «оттяни и отпусти»: показываем пунктир на время драга,
    // при скрытии форсируем fullRedraw — иначе хвост линии остаётся на песке
    // до следующей полной перерисовки (выстрел её не гарантирует сразу).
    setAimPreviewVisible = (visible: boolean) => {
        if (this.showAimPreview === visible) return;
        this.showAimPreview = visible;
        if (!visible) this.fullRedraw();
    };

    /**
     * Предпросмотр траектории при жесте-рогатке (issue #475): пунктирная **дуга** от
     * ствола, посчитанная тем же кодом, что и полёт снаряда (`fillTrajectoryPreview`
     * → `advanceProjectile`), с учётом ветра боя. Показываем НЕ полёт до попадания, а
     * первые ~30–40% пути и затухаем к концу — довести прицел игрок обязан сам
     * (дуга, а не точка падения; вердикт handoff по п.3 из GDD сохранён). Рядом со
     * стволом — компактный индикатор «угол·сила», чтобы значения были у взгляда, а
     * не только в верхнем HUD. При `prefers-reduced-motion` пунктир статичен.
     *
     * Луч оттяжки, кольцо пальца и чип живут в DOM-оверлее (`ui/gesture-overlay`),
     * где доступны токены и текст; здесь — заякоренная на стволе дуга в canvas-координатах.
     *
     * Начало дуги — точка крепления ствола (`gunpointX/gunpointY`), а не дульный срез
     * (`Tank.calcBulletStartPos` = gunpoint + длина ствола): дуга параллельно смещена
     * от истинной траектории на длину ствола (~35·scale px), направление и кривизна при
     * этом совпадают с полётом (тот же `advanceProjectile`, ветер и гравитация).
     */
    private drawAimPreview(ctx: CanvasRenderingContext2D) {
        if (!this.leftTank || !this.rightTank) return;
        const [activeTank] = this.getActiveAndTargetTanks(this.leftTank, this.rightTank);
        this.aimArcFrom.x = activeTank.gunpointX;
        this.aimArcFrom.y = activeTank.gunpointY;
        const count = fillTrajectoryPreview(
            {
                x: activeTank.gunpointX,
                y: activeTank.gunpointY,
                angle: activeTank.gunpointAngle,
                power: activeTank.power,
                wind: this.wind,
                // Та же гравитация, что и у реального снаряда (`Bullet.gravity`),
                // проброшена явно — дуга и полёт считают ускорение одним числом (#475).
                gravity: BULLET_GRAVITY,
                innerHeight: this.innerHeight,
                radius: WORLD_UNITS.bulletRadius * activeTank.scale,
            },
            this.aimArcPoints,
        );
        const isMax = activeTank.power >= activeTank.powerMax;
        const color = isMax ? ENGINE_COLORS.danger : ENGINE_COLORS.accent;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        // setLineDash копирует массив внутрь — модульная константа, без аллокации.
        ctx.setLineDash(SEGMENT_DASH as number[]);
        // Бегущий пунктир: смещение по времени кадра. При reduced-motion — 0 (статика).
        ctx.lineDashOffset = this.reducedMotion ? 0 : -(this.lastFrameTs * ARC_DASH_SPEED);
        // Дуга рисуется посегментно: каждый сегмент со своей прозрачностью — так дуга
        // затухает к концу (issue «затухающая к концу»), чего одним stroke не сделать.
        let prevX = this.aimArcFrom.x;
        let prevY = this.aimArcFrom.y;
        for (let i = 0; i < count; i++) {
            const t = count > 1 ? i / (count - 1) : 0;
            ctx.globalAlpha = SEGMENT_OPACITY * (1 - t * (1 - ARC_TAIL_OPACITY_FACTOR));
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(this.aimArcPoints[i].x, this.aimArcPoints[i].y);
            ctx.stroke();
            prevX = this.aimArcPoints[i].x;
            prevY = this.aimArcPoints[i].y;
        }
        ctx.setLineDash(NO_DASH as number[]);
        ctx.lineDashOffset = 0;
        ctx.restore();

        this.drawBarrelReadout(ctx, activeTank, isMax, color);
    }

    /**
     * Компактный индикатор «угол·сила» у ствола (issue #475): значения рядом со
     * взглядом игрока, а не только в верхней панели. Тёмная обводка под текстом —
     * читаемость на песке и небе. На максимуме силы — «МАКС» и цвет danger, как у
     * чипа оверлея. Текст на канвасе (не в DOM), потому что он заякорен точно на
     * стволе в canvas-координатах и живёт лишь во время жеста.
     */
    private drawBarrelReadout(
        ctx: CanvasRenderingContext2D,
        activeTank: Tank,
        isMax: boolean,
        color: string,
    ) {
        const label = `${formatAngle(activeTank.gunpointAngle)}° · ${isMax ? 'МАКС' : activeTank.power}`;
        const x = activeTank.gunpointX;
        const y = activeTank.gunpointY - BARREL_LABEL_OFFSET;
        ctx.save();
        ctx.font = BARREL_LABEL_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.strokeText(label, x, y);
        ctx.fillStyle = color;
        ctx.fillText(label, x, y);
        ctx.restore();
    }

    changeTankPower = (delta: number) => {
        if (!this.leftTank || !this.rightTank || !this.leftTank.isActive) return;
        const [activeTank] = this.getActiveAndTargetTanks(this.leftTank, this.rightTank);
        if (
            activeTank.power + delta >= activeTank.powerMin &&
            activeTank.power + delta <= activeTank.powerMax
        ) {
            this.callbacks.onPowerChange(delta);
        }
    };

    loadImages = () => {
        if (this.ctx) {
            this.animate();
            return;
        }
        const sandImg = new Image();
        const sandLoaded = new Promise<void>((resolve) => {
            sandImg.onload = () => resolve();
            sandImg.onerror = () => resolve();
        });
        sandImg.src = GAME_ASSET_PATHS.sand;
        GamePlay.images.sand = sandImg;

        // Скины (issue #481) грузятся/кэшируются отдельно от `GamePlay.images`
        // (см. `tank-skin-image-cache.ts`) — кэш общий на всё приложение по
        // skinId, повторный бой с тем же скином не пересобирает Image.
        void Promise.all([
            sandLoaded,
            loadTankSkinImages(this.leftSkinId),
            loadTankSkinImages(this.rightSkinId),
        ]).then(([, leftSkinImages, rightSkinImages]) => {
            this.leftSkinImages = leftSkinImages;
            this.rightSkinImages = rightSkinImages;
            this.isImagesLoaded = true;
            this.initPaint();
        });
    };

    // Подгоняет бэкинг-стор canvas под CSS-размер и devicePixelRatio.
    // innerWidth/innerHeight — ЛОГИЧЕСКИЕ (CSS) пиксели: вся физика и рисование
    // в них, а ctx масштабируется на dpr, поэтому картинка чёткая на ретине.
    // Возвращает true, если логический размер или бэкинг-стор изменились
    // (в обоих случаях нужна перерисовка сцены).
    fit = (): boolean => {
        const canvas = this.canvasRef.current;
        if (!canvas) return false;
        const dpr = getDevicePixelRatio();
        // Режим реплея: логический размер зафиксирован записью, экранный размер
        // canvas игнорируем — картинку в экран вписывает CSS (object-contain).
        let cssWidth: number;
        let cssHeight: number;
        if (this.fixedLogicalSize) {
            cssWidth = this.fixedLogicalSize.width;
            cssHeight = this.fixedLogicalSize.height;
        } else {
            const rect = canvas.getBoundingClientRect();
            cssWidth = floor(rect.width || canvas.offsetWidth || this.innerWidth);
            cssHeight = floor(rect.height || canvas.offsetHeight || this.innerHeight);
        }
        const backingWidth = toDevicePixels(cssWidth, dpr);
        const backingHeight = toDevicePixels(cssHeight, dpr);
        // Смена только dpr (перенос окна между мониторами, зум) меняет бэкинг-стор
        // при том же CSS-размере — canvas очищается, поэтому это тоже «изменение».
        const changed =
            this.innerWidth !== cssWidth ||
            this.innerHeight !== cssHeight ||
            canvas.width !== backingWidth ||
            canvas.height !== backingHeight;

        // Присваивание canvas.width/height сбрасывает контекст (transform → identity,
        // очистка), поэтому меняем только при реальном изменении и заново ставим базу.
        if (canvas.width !== backingWidth) canvas.width = backingWidth;
        if (canvas.height !== backingHeight) canvas.height = backingHeight;
        this.innerWidth = cssWidth;
        this.innerHeight = cssHeight;
        // Высота канваса могла измениться (ресайз/поворот) — свободная зона от неё
        // производна, пересчитываем вместе с логическим размером.
        this.recomputeArenaZone();
        if (this.ctx) {
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        return changed;
    };

    private observeResize = () => {
        const canvas = this.canvasRef.current;
        if (!canvas || typeof ResizeObserver === 'undefined' || this.resizeObserver) return;
        // Реагируем на resize окна и поворот телефона: коалесцируем в один rAF.
        this.resizeObserver = new ResizeObserver(() => {
            if (this.resizeRafId !== undefined) return;
            this.resizeRafId = requestAnimationFrame(() => {
                this.resizeRafId = undefined;
                this.applyResize();
            });
        });
        this.resizeObserver.observe(canvas);
    };

    private applyResize = () => {
        if (!this.ctx || !this.ground || !this.leftTank || !this.rightTank) return;
        const prevWidth = this.innerWidth;
        const prevHeight = this.innerHeight;
        if (!this.fit()) return;
        if (prevWidth !== this.innerWidth || prevHeight !== this.innerHeight) {
            const worldScale = computeWorldScale(this.innerWidth);
            this.rescaleTerrainAndTanks(worldScale);
            this.rescaleBullet(prevWidth, prevHeight, worldScale);
        }
        // Даже при смене только dpr бэкинг-стор пересоздан (canvas очищен) —
        // перерисовка нужна безусловно.
        this.fullRedraw();
    };

    // Пересчитывает террейн под новый размер (Ground.resize — без RNG, форма и
    // детерминизм сохраняются) и переставляет танки пропорционально. Масштаб мира
    // (issue #455) считается один раз в applyResize и передаётся сюда, чтобы танки и
    // снаряд в полёте (rescaleBullet) масштабировались одним и тем же коэффициентом.
    private rescaleTerrainAndTanks = (worldScale: number) => {
        if (!this.leftTank || !this.rightTank || !this.ground) return;
        this.ground.resize(this.innerWidth, this.innerHeight);
        const leftTankX = floor(this.innerWidth / 4);
        const rightTankX = floor((this.innerWidth * 3) / 4);
        for (const [tank, x] of [
            [this.leftTank, leftTankX],
            [this.rightTank, rightTankX],
        ] as const) {
            tank.innerWidth = this.innerWidth;
            tank.innerHeight = this.innerHeight;
            tank.setScale(worldScale);
            tank.x = x;
            tank.y = this.innerHeight - this.ground.heights[x];
            tank.dx = 0;
            tank.dy = 0;
        }
    };

    // Снаряд в полёте переносится в новые координаты пропорционально: сброс терял бы
    // уже израсходованное оружие и подвешивал ход на игроке (ревью PR #41). Радиус
    // снаряда и взрыва тоже масштабируются новым коэффициентом (issue #455) — тем же,
    // что получают танки, — иначе после ресайза корпус стал бы больше, а снаряд и
    // кратер остались бы прежнего размера. Эффект косметический (на реплей не влияет:
    // там размер зафиксирован записью, ресайза нет).
    private rescaleBullet = (prevWidth: number, prevHeight: number, worldScale: number) => {
        if (!this.bullet) return;
        this.bullet.x = floor((this.bullet.x * this.innerWidth) / prevWidth);
        this.bullet.y = floor((this.bullet.y * this.innerHeight) / prevHeight);
        this.bullet.lastX = this.bullet.x;
        this.bullet.lastY = this.bullet.y;
        this.bullet.innerWidth = this.innerWidth;
        this.bullet.innerHeight = this.innerHeight;
        this.bullet.setScale(worldScale);
    };

    initPaint = () => {
        const canvas = this.canvasRef.current;
        if (canvas) {
            this.ctx = canvas.getContext('2d');
        }
        this.fit();
        // Размер и инсеты safe-зоны, на которых реально пойдёт физика этого боя, —
        // их пишет реплей. Инсеты берём те, что активны сейчас (их успел донести
        // `setArenaInsets` до асинхронного initPaint) — рельеф генерится под них,
        // и ровно они записываются: реплей воспроизведёт тот же рельеф.
        this.callbacks.onFieldInit?.({
            width: this.innerWidth,
            height: this.innerHeight,
            insets: this.arenaInsets,
        });
        const { sand } = GamePlay.images;
        const { leftTankWeapons, rightTankWeapons } = this.allWeapons;
        this.ground = new Ground(
            this.innerWidth,
            this.innerHeight,
            this.random,
            sand,
            this.arenaInsets,
        );
        this.wind = generateWind(this.random);
        this.callbacks.onWindInit?.(this.wind);
        // Масштаб мира от ширины арены (issue #455): танки/ствол/снаряд/взрыв
        // считаются в мировых единицах и рисуются через этот коэффициент. В режиме
        // реплея innerWidth зафиксирован записью → scale тот же, что при записи.
        const worldScale = computeWorldScale(this.innerWidth);
        const leftTankX = floor(this.innerWidth / 4);
        const leftTankY = this.innerHeight - this.ground.heights[leftTankX];
        // Геометрия катков (позиции/радиус) — из реестра скинов по id, картинка
        // катка — из уже загруженного `skinImages.wheel` (issue #496). Скин
        // косметика: сама геометрия катков на боевые поля Tank не влияет
        // (см. tank-skin-parity.test.ts).
        const leftWheels = getTankSkinById(this.leftSkinId).geometry.wheels;
        const rightWheels = getTankSkinById(this.rightSkinId).geometry.wheels;
        this.leftTank = new Tank(
            leftTankX,
            leftTankY,
            this.innerWidth,
            this.innerHeight,
            0,
            leftTankWeapons,
            this.leftSkinImages?.hull,
            this.leftSkinImages?.barrel,
            worldScale,
            this.leftSkinImages?.wheel,
            leftWheels,
            !this.reducedMotion,
        );
        this.leftTank.isActive = true;
        // Игрок всегда ходит первым (см. §GDD) — HUD узнаёт об этом здесь же,
        // не дожидаясь первой передачи хода через changeActiveTank.
        this.callbacks.onTurnChange?.('player');

        const rightTankX = floor((this.innerWidth * 3) / 4);
        const rightTankY = this.innerHeight - this.ground.heights[rightTankX];
        this.rightTank = new Tank(
            rightTankX,
            rightTankY,
            this.innerWidth,
            this.innerHeight,
            Math.PI,
            rightTankWeapons,
            this.rightSkinImages?.hull,
            this.rightSkinImages?.barrel,
            worldScale,
            this.rightSkinImages?.wheel,
            rightWheels,
            !this.reducedMotion,
        );
        if (this.ctx) {
            this.ground.draw(this.ctx);
        }
        this.animate();
        this.fullRedraw();
        this.observeResize();
    };

    getActiveAndTargetTanks = (t1: Tank, t2: Tank) => (t1.isActive ? [t1, t2] : [t2, t1]);

    changeActiveTank = () => {
        if (this.leftTank && this.rightTank) {
            [this.leftTank.isActive, this.rightTank.isActive] = this.leftTank.isActive
                ? [false, true]
                : [true, false];
            this.callbacks.onTurnChange?.(this.leftTank.isActive ? 'player' : 'enemy');
            this.fullRedraw();
        }
    };

    private checkGameOver = () => {
        if (!this.leftTank || !this.rightTank) return;
        this.callbacks.onGameOverCheck({
            leftWeapons: this.leftTank.weapons.length,
            rightWeapons: this.rightTank.weapons.length,
        });
    };

    animate = () => {
        // Бой заморожен по концу боя (HP-добивание) — цикл не крутим и не
        // планируем следующий кадр: сцена застыла на кадре добивания под модалкой.
        if (this.isOver) return;
        this.rafTimerId = requestAnimationFrame(this.animate);
        const now = performance.now();
        // Реальный dt между кадрами rAF — для затухания shake и slow-mo независимо
        // от throttle (иначе замедление/тряска «зависли» бы вместе с симуляцией).
        const frameDt = this.lastFrameTs ? now - this.lastFrameTs : 0;
        this.lastFrameTs = now;
        // Ровно раз за тик: если кратер ещё осыпался в прошлом кадре, помечает
        // offscreen-слой террейна снова грязным (см. Ground.beginFrame).
        this.ground?.beginFrame();
        this.checkGameOver();

        // Slow-mo растягивает интервал шага: масштаб < 1 → шаги реже → взрыв,
        // частицы и осыпание земли идут в замедлении.
        const timeScale = this.slowMo.update(frameDt);
        const minInterval = BASE_FRAME_INTERVAL_MS / timeScale;
        const particlesAlive = this.particles.hasAlive();
        const shakeActive = this.camera.isActive();
        const trailActive = this.trail.hasActive();
        if (
            now - this.prevTimestamp < minInterval ||
            !this.ctx ||
            !this.leftTank ||
            !this.rightTank ||
            !this.ground ||
            // Пока частицы летят, сцена дрожит, дотлевает след снаряда ИЛИ бежит
            // пунктир дуги предпросмотра (жест-рогатка, не reduced-motion) — крутим
            // цикл даже в idle, чтобы кадр перерисовывал анимированную дугу.
            (this.isIdleMode() &&
                !particlesAlive &&
                !shakeActive &&
                !trailActive &&
                !(this.showAimPreview && !this.reducedMotion))
        ) {
            // Тряска только что закончилась в тихом кадре — вернём сцену на место.
            if (this.wasShaking && !shakeActive && this.ctx) {
                this.fullRedraw();
                this.wasShaking = false;
            }
            return;
        }

        const stepDt = now - this.prevTimestamp;
        this.prevTimestamp = now;
        // Дрожание — по реальному времени шага, чтобы длительность не зависела
        // от FPS/slow-mo (смещение пересчитывается и применяется в fullRedraw).
        this.camera.update(stepDt);
        this.wasShaking = this.camera.isActive();
        if (particlesAlive || shakeActive) {
            // Частицы разлетаются далеко за полосу точечной перерисовки взрыва, а
            // тряска сдвигает всю сцену — в обоих случаях перерисовываем целиком.
            if (particlesAlive) this.particles.update();
            this.fullRedraw();
        } else if (
            (this.isFireMode && (!this.bullet || this.bullet.explosionRadius)) ||
            this.ground.isFalling
        ) {
            if (this.bullet) {
                this.explosionAreaRedraw(this.bullet);
                this.tankAreaRedraw([this.leftTank, this.rightTank]);
            } else {
                this.fullRedraw();
            }
        } else if (!this.bullet) {
            this.tankAreaRedraw([this.leftTank, this.rightTank]);
        }

        this.isAngleMode = false;
        if (this.isMoveMode && !this.leftTank.dx) {
            this.isMoveMode = false;
        }
        if (
            this.isFireMode &&
            !this.bullet &&
            !this.ground.isFalling &&
            !this.leftTank.dy &&
            !this.rightTank.dy
        ) {
            if (this.rightTank.isActive) {
                this.rightTank.isActive = false;
                this.botAiming();
                if (this.rightTank.isReadyToFire) {
                    this.tankAreaRedraw([this.leftTank, this.rightTank]);
                    this.botFire();
                }
            } else {
                this.activateMode('idle');
            }
        }

        this.moveBullet(this.ctx);

        // Частицы и след — поверх всего (сцена, взрыв, снаряд уже нарисованы этим кадром).
        // Каждая точка следа сама очищает свой прошлый прямоугольник (bullet-trail.ts),
        // поэтому trail.draw безопасен и без fullRedraw этого кадра.
        if (particlesAlive) {
            this.particles.draw(this.ctx);
        }
        if (trailActive) {
            this.trail.draw(this.ctx);
        }

        // fullRedraw мог оставить сдвиг тряски в трансформе — сбрасываем в базу,
        // чтобы следующий кадр с точечной перерисовкой не чистил смещённую область.
        if (this.camera.offsetX || this.camera.offsetY) {
            const dpr = getDevicePixelRatio();
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    };

    private tankAreaRedraw(tanks: Tank[]) {
        // Линия прицела может выходить далеко за паддинг вокруг танка — точечная
        // перерисовка её не очистит, поэтому во время оттяжки берём fullRedraw.
        if (this.showAimPreview) {
            this.fullRedraw();
            return;
        }
        this.redrawGroundUnderTanks(tanks);
        tanks.forEach((tank) => {
            if (this.ctx && this.ground) {
                tank.draw(this.ctx, this.mousePos, this.ground);
            }
        });
    }

    private explosionAreaRedraw(bullet: Bullet) {
        const padding = 5;
        if (this.ctx && this.ground) {
            this.ctx.clearRect(
                bullet.x - bullet.explosionRadius - padding,
                0,
                bullet.explosionRadius * 2 + padding * 2,
                this.innerHeight,
            );
            this.ground.draw(
                this.ctx,
                bullet.x - bullet.explosionRadius - padding,
                bullet.x + bullet.explosionRadius * 2 + padding,
            );
        }
    }

    fullRedraw() {
        if (!this.ctx || !this.leftTank || !this.rightTank || !this.ground) return;
        // Screen shake: сдвигаем всю сцену на смещение камеры (0 вне тряски).
        // Трансформ включает dpr, сдвиг задаём в CSS-пикселях (× dpr).
        const ox = this.camera.offsetX;
        const oy = this.camera.offsetY;
        const dpr = getDevicePixelRatio();
        this.ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
        // Чистим с запасом на сдвиг, иначе на краю остаётся полоса прошлого кадра.
        const padX = SHAKE_CLEAR_PAD + Math.abs(ox);
        const padY = SHAKE_CLEAR_PAD + Math.abs(oy);
        this.ctx.clearRect(-padX, -padY, this.innerWidth + padX * 2, this.innerHeight + padY * 2);
        this.ground.draw(this.ctx);
        this.leftTank.draw(this.ctx, this.mousePos, this.ground);
        this.rightTank.draw(this.ctx, this.mousePos, this.ground);
        if (this.showAimPreview) this.drawAimPreview(this.ctx);
    }

    private redrawGroundUnderTanks(tanks: Tank[]) {
        tanks.forEach((tank) => {
            const padding = 50;
            if (this.ctx && this.ground) {
                this.ctx.clearRect(
                    tank.x - padding,
                    0,
                    tank.tankWidth + padding * 2,
                    this.innerHeight,
                );
                this.ground.draw(this.ctx, tank.x - padding, tank.x + tank.tankWidth + padding);
            }
        });
    }

    // Реплика бота по исходу выстрела: кто задет (никто/сам стрелявший/
    // противник) определяет категорию, this.random выбирает конкретный текст —
    // детерминировано на seed боя, как и остальная физика. На своём промахе
    // или самостреле бот молчит (resolveBotReplyCategory → null).
    private emitBotReply() {
        if (!this.bullet || !this.leftTank || !this.rightTank) return;
        const shooterIsBot = !this.lastShooterIsLeft;
        const firedTank = this.lastShooterIsLeft ? this.leftTank : this.rightTank;
        const hit = !this.bullet.isTankHit
            ? 'none'
            : this.bullet.hittedTank === firedTank
              ? 'self'
              : 'opponent';
        const category = resolveBotReplyCategory({ shooterIsBot, hit });
        // Свой промах/самострел бот не комментирует — resolve вернёт null.
        if (!category) return;
        this.callbacks.onBotReply(pickBotReply(category, this.random));
    }

    moveBullet = (ctx: CanvasRenderingContext2D) => {
        if (!this.isFireMode || !this.bullet) return;
        this.bullet.move();
        // explosionRadius === 0 значит снаряд ещё летит (взрыв этого тика не начат) —
        // след кладём только вдоль полёта, не поверх растущего взрыва.
        if (this.bullet.explosionRadius === 0) {
            this.trail.emit(this.bullet.x, this.bullet.y);
        }
        if (this.bullet.isHit(ctx)) {
            // explosionRadius === 0 только в первый кадр взрыва — разрешение попадания
            // (звук, очки, подскок танка, косметика) эмитим один раз, дальше
            // drawExplosion его инкрементирует и повторного разрешения не будет.
            if (this.bullet.explosionRadius === 0) {
                if (this.bullet.isTankHit) {
                    this.particles.emitBurst(damageFlashBurst(this.bullet.x, this.bullet.y));
                    // Попадание в танк: сильная тряска + короткий slow-mo для веса удара.
                    this.camera.addTrauma(HIT_SHAKE_TRAUMA);
                    this.slowMo.trigger();
                } else {
                    this.particles.emitBurst(groundBurst(this.bullet.x, this.bullet.y));
                    // Промах по земле: только лёгкая тряска, без замедления.
                    this.camera.addTrauma(MISS_SHAKE_TRAUMA);
                }
                this.emitBotReply();

                if (this.bullet.isTankHit && this.bullet.hittedTank) {
                    void this.audio.playSfx('hit');
                    this.bullet.hittedTank.jumpOnHit(
                        this.bullet.power,
                        this.bullet.gravity,
                        this.bullet.dx,
                    );
                    this.callbacks.onTankHit({
                        hittedIsLeft: this.bullet.hittedTank === this.leftTank,
                        leftActive: !!this.leftTank?.isActive,
                        power: this.bullet.power,
                    });
                } else {
                    void this.audio.playSfx('miss');
                }
            }
            this.bullet.drawExplosion(ctx);
        }

        if (!this.bullet.isFinished) {
            this.bullet?.draw(ctx);
            return;
        }
        this.bullet = undefined;
        this.callbacks.onShotEnd?.();
        this.changeActiveTank();
    };

    botFire = () => {
        if (!this.leftTank || !this.rightTank || !this.ground) return;
        const weapon = this.rightTank.weapons[0];
        if (!weapon) return;
        this.fire(this.rightTank, this.leftTank, this.ground, weapon);
        this.rightTank.isReadyToFire = false;
    };

    botAiming = () => {
        if (!this.leftTank || !this.rightTank || !this.ground) return;
        this.mousePos = null;
        const angleStep = 0.01;
        let startAngle = (3 * Math.PI) / 2;
        const startPower = 2;
        const [step, stopCondition] =
            this.leftTank.x < this.rightTank.x
                ? [-angleStep, (curAngle: number) => curAngle > Math.PI]
                : [angleStep, (curAngle: number) => curAngle < 2 * Math.PI];

        const isOverMissing = (hitX: number, tank: Tank) => {
            const isFireMissLeft = step < 0 && hitX < tank.x;
            const isFireMissRight = step > 0 && hitX > tank.x + tank.tankWidth;
            return isFireMissLeft || isFireMissRight;
        };

        for (let curPower = startPower; curPower < 18; curPower += 1) {
            for (let currentAngle = startAngle; stopCondition(currentAngle); currentAngle += step) {
                this.rightTank.canHarmYourself = false;
                const { hitX, isTankHit } = this.virtualFire(currentAngle, curPower);

                if (isTankHit || isOverMissing(hitX, this.leftTank)) {
                    if (!isTankHit) {
                        if (
                            !this.rightTank.closestToHit ||
                            Math.abs(hitX - this.leftTank.x) < this.rightTank.closestToHit.minDiff
                        ) {
                            const count = this.rightTank.closestToHit?.count || 0;
                            this.rightTank.closestToHit = {
                                angle: currentAngle,
                                power: curPower,
                                minDiff: Math.abs(hitX - this.leftTank.x),
                                count,
                            };
                        }
                        startAngle = currentAngle - 2 * step;
                        break;
                    }
                    this.rightTank.gunpointAngle +=
                        this.random() *
                        (this.maxGameDifficulty - this.gameDifficulty) *
                        (step / 10);
                    this.rightTank.isReadyToFire = true;
                    this.rightTank.canHarmYourself = true;
                    this.rightTank.closestToHit = null;
                    return;
                }
            }
        }
        if (this.rightTank.closestToHit) {
            this.rightTank.gunpointAngle = this.rightTank.closestToHit.angle;
            this.rightTank.power = this.rightTank.closestToHit.power;
            const delta = this.rightTank.x > this.innerWidth / 2 ? -10 : 10;
            this.rightTank.x += this.rightTank.closestToHit.count > 1 ? delta : 0;
            this.rightTank.closestToHit.count += 1;
        }
        this.rightTank.isReadyToFire = true;
        this.rightTank.canHarmYourself = true;
    };

    virtualFire(angle: number, power: number): { hitX: number; isTankHit: boolean } {
        if (!this.ctx || !this.leftTank || !this.rightTank || !this.ground) {
            return { hitX: 0, isTankHit: false };
        }
        this.rightTank.gunpointAngle = angle;
        this.rightTank.power = power;
        const virtualBullet = new Bullet(
            this.innerWidth,
            this.innerHeight,
            this.ground,
            this.rightTank,
            this.leftTank,
            this.wind,
        );
        virtualBullet.move();
        while (!virtualBullet.isHit(this.ctx)) {
            virtualBullet.move();
        }
        return { hitX: virtualBullet.x, isTankHit: virtualBullet.isTankHit };
    }

    onFire = (weaponType: TWeapon) => {
        if (!this.leftTank || !this.rightTank || !this.ground || !weaponType) return;
        this.fire(this.leftTank, this.rightTank, this.ground, weaponType);
    };

    fire = (activeTank: Tank, targetTank: Tank, ground: Ground, weaponType: TWeapon) => {
        this.lastShooterIsLeft = activeTank === this.leftTank;
        this.callbacks.onShotStart?.();
        this.activateMode('fire');
        this.bullet = new Bullet(
            this.innerWidth,
            this.innerHeight,
            ground,
            activeTank,
            targetTank,
            this.wind,
        );
        void this.audio.playSfx('fire');
        activeTank.fire(weaponType);
    };

    activateMode(mode: TGameMode) {
        switch (mode) {
            case 'fire':
                this.isFireMode = true;
                this.isAngleMode = false;
                this.isMoveMode = false;
                break;
            case 'angle':
                if (!this.isFireMode) {
                    this.isAngleMode = true;
                    this.isMoveMode = false;
                }
                break;
            case 'move':
                if (!this.isFireMode) {
                    this.isMoveMode = true;
                    this.isAngleMode = false;
                }
                break;
            case 'idle':
            default:
                this.isFireMode = false;
                this.isAngleMode = false;
                this.isMoveMode = false;
        }
    }

    isIdleMode() {
        return !this.isFireMode && !this.isAngleMode && !this.isMoveMode;
    }

    /**
     * Замораживает бой по концу боя (в отличие от `destroy` — не рвёт resize и не
     * освобождает движок, сцена остаётся видимой под модалкой). Останавливает цикл
     * rAF (бот больше не ходит), поднимает `isOver` — обработчики ввода в
     * `GameCanvas` по нему гасят выстрелы/манёвры после game over.
     */
    stop() {
        this.isOver = true;
        if (this.rafTimerId !== undefined) {
            cancelAnimationFrame(this.rafTimerId);
            this.rafTimerId = undefined;
        }
    }

    destroy() {
        if (this.rafTimerId !== undefined) {
            cancelAnimationFrame(this.rafTimerId);
            this.rafTimerId = undefined;
        }
        if (this.resizeRafId !== undefined) {
            cancelAnimationFrame(this.resizeRafId);
            this.resizeRafId = undefined;
        }
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
    }
}
