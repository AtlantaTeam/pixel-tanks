import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { getAudioEngine } from '@/shared/lib/audio';
import { EWeaponKind, type TWeapon } from '@/shared/model';
import { GamePlay, type TGamePlayCallbacks } from './game-play';
import { Ground } from './ground';
import { Tank } from './tank';
import { Bullet } from './bullet';
import { WEAPON_SPECS } from './weapon-specs';
import { pickPrecipPreset } from './precipitation';
import { STORM_WIND_SHIFT_AFTER_SHOTS } from './weather-modifiers';
import { windFlagRotationRad, windFlagSide } from './wind-flag';

/**
 * Issue #263: разрешение попадания (звук, очки, подскок танка) стояло вне
 * гварда `explosionRadius === 0` в `moveBullet` и повторялось каждый кадр
 * анимации взрыва (~50 кадров). Тест прогоняет несколько кадров с уже
 * состоявшимся попаданием и проверяет, что разрешение случилось ровно раз.
 */

// Tank создаёт `new Path2D()` в конструкторе безусловно — happy-dom его не
// предоставляет, поэтому нужна лёгкая заглушка (contains здесь не нужен,
// isTankHit подставляется вручную, а не через ctx.isPointInPath).
class Path2DStub {
    rect() {}
    addPath() {}
}

beforeAll(() => {
    if (typeof globalThis.Path2D === 'undefined') {
        vi.stubGlobal('Path2D', Path2DStub);
    }
});

/**
 * Единственная ctx-заглушка файла: no-op на всё, что зовёт отрисовка, плюс журналы
 * тех вызовов, которые читают тесты точечной перерисовки — `clearRect` (зона
 * очистки), `fillRect` (пиксели вспышки и снаряда), `ellipse` (тень танка).
 *
 * Одна на файл намеренно: раньше их было три почти одинаковых, и любой новый вызов
 * канваса в движке пришлось бы дописывать в каждую (ревью #601). Проба контура
 * (`isPointInPath`) всегда отрицательная — попадание по танку сценарии задают явно
 * (`isTankHit`), а не через геометрию заглушки.
 */
class CtxStub {
    fillStyle = '';
    strokeStyle = '';
    lineWidth = 0;
    lineJoin = 'miter';
    globalAlpha = 1;
    imageSmoothingEnabled = true;
    /** Журнал `clearRect`: [x, y, width, height]. */
    clearRects: number[][] = [];
    /** Журнал `fillRect`: [x, y, width, height]. */
    fillRects: number[][] = [];
    /** Журнал `ellipse`: [x, y, radiusX, radiusY]. */
    ellipses: number[][] = [];

    clearRect(x: number, y: number, w: number, h: number) {
        this.clearRects.push([x, y, w, h]);
    }
    fillRect(x: number, y: number, w: number, h: number) {
        this.fillRects.push([x, y, w, h]);
    }
    ellipse(x: number, y: number, rx: number, ry: number) {
        this.ellipses.push([x, y, rx, ry]);
    }
    isPointInPath() {
        return false;
    }
    save() {}
    restore() {}
    setTransform() {}
    beginPath() {}
    closePath() {}
    rect() {}
    clip() {}
    moveTo() {}
    lineTo() {}
    arc() {}
    translate() {}
    rotate() {}
    fill() {}
    stroke() {}
    drawImage() {}
    setLineDash() {}
    getTransform() {
        return new DOMMatrix();
    }
    createPattern() {
        return null;
    }
    createRadialGradient() {
        return { addColorStop: () => undefined };
    }
}

/** Заглушка в типе канваса — каст в одном месте, а не на каждом вызове. */
const asCtx = (stub: CtxStub) => stub as unknown as CanvasRenderingContext2D;

const ctxStub = asCtx(new CtxStub());

const WIDTH = 800;
const HEIGHT = 600;
const WEAPON: TWeapon = { id: 0, name: 'Фугас', kind: EWeaponKind.HighExplosive };

/**
 * Собирает `GamePlay` с двумя танками и грунтом, готовый к прогону `moveBullet`.
 * Снаряд создаётся, но не подставляется — сценарий (попадание/промах) настраивает
 * его сам, поэтому bullet и оба танка возвращаются наружу.
 */
function makeGamePlay() {
    const callbacks: TGamePlayCallbacks = {
        onTankHit: vi.fn(),
        onGameOverCheck: vi.fn(),
        onMovesChange: vi.fn(),
        onPowerChange: vi.fn(),
        onBotReply: vi.fn(),
        onTurnChange: vi.fn(),
        onShotStart: vi.fn(),
        onShotEnd: vi.fn(),
    };
    const random = createSeededRandom(1);
    const ground = new Ground(WIDTH, HEIGHT, random);
    const leftTank = new Tank(200, HEIGHT - ground.heights[200], WIDTH, HEIGHT, 0, [WEAPON]);
    leftTank.isActive = true;
    const rightTank = new Tank(600, HEIGHT - ground.heights[600], WIDTH, HEIGHT, Math.PI, [WEAPON]);

    const gamePlay = new GamePlay(
        { current: null },
        { leftTankWeapons: [WEAPON], rightTankWeapons: [WEAPON] },
        callbacks,
        random,
        createSeededRandom(2),
        { fixedLogicalSize: { width: WIDTH, height: HEIGHT } },
    );
    gamePlay.ground = ground;
    gamePlay.leftTank = leftTank;
    gamePlay.rightTank = rightTank;
    gamePlay.isFireMode = true;

    const bullet = new Bullet(WIDTH, HEIGHT, ground, leftTank, rightTank, 0);

    return { gamePlay, callbacks, leftTank, rightTank, ground, bullet };
}

describe('GamePlay.moveBullet — разрешение попадания на многокадровом взрыве', () => {
    it('звук, начисление очков и подскок танка срабатывают ровно один раз за несколько кадров анимации', () => {
        const { gamePlay, callbacks, rightTank, bullet } = makeGamePlay();

        // Попадание уже состоялось (isTankHit=true) — как будто isHit() уже
        // отработал в кадре, когда снаряд коснулся танка.
        bullet.isTankHit = true;
        bullet.hittedTank = rightTank;
        gamePlay.bullet = bullet;

        const playSfx = vi
            .spyOn(getAudioEngine(), 'playSfx')
            .mockImplementation(() => Promise.resolve());
        const jumpOnHit = vi.spyOn(rightTank, 'jumpOnHit');

        for (let frame = 0; frame < 5; frame += 1) {
            gamePlay.moveBullet(ctxStub);
        }

        expect(playSfx).toHaveBeenCalledTimes(1);
        expect(playSfx).toHaveBeenCalledWith('hit');
        expect(jumpOnHit).toHaveBeenCalledTimes(1);
        expect(callbacks.onTankHit).toHaveBeenCalledTimes(1);
    });

    it('промах по земле проигрывает "miss" ровно один раз за несколько кадров анимации', () => {
        const { gamePlay, callbacks, bullet } = makeGamePlay();

        // Реальный isHit() промаха требует прогона Path2D-проверки и полёта до
        // земли/границы — здесь важен только факт «попадание уже решено, и это
        // промах», поэтому isHit форсируется напрямую (isHit — поле экземпляра,
        // не метод прототипа, поэтому переопределение безопасно).
        bullet.isTankHit = false;
        bullet.isHit = () => true;
        gamePlay.bullet = bullet;

        const playSfx = vi
            .spyOn(getAudioEngine(), 'playSfx')
            .mockImplementation(() => Promise.resolve());

        for (let frame = 0; frame < 5; frame += 1) {
            gamePlay.moveBullet(ctxStub);
        }

        expect(playSfx).toHaveBeenCalledTimes(1);
        expect(playSfx).toHaveBeenCalledWith('miss');
        expect(callbacks.onTankHit).not.toHaveBeenCalled();
    });
});

describe('GamePlay.moveBullet — многоочаговый кластер (ловушка #483)', () => {
    // Кластер отыгрывает три очага подряд, каждый сбрасывает explosionRadius в ноль.
    // Разовая раздача (урон, звук, подскок) обязана сработать ОДИН раз на все три
    // очага — иначе перегруженный сентинел `explosionRadius === 0` раздал бы её трижды.
    it('раздаёт урон, звук и подскок ровно один раз на три очага', () => {
        const { gamePlay, callbacks, ground, leftTank, rightTank } = makeGamePlay();
        const bullet = new Bullet(
            WIDTH,
            HEIGHT,
            ground,
            leftTank,
            rightTank,
            0,
            WEAPON_SPECS[EWeaponKind.Cluster],
        );
        bullet.isTankHit = true;
        bullet.hittedTank = rightTank;
        gamePlay.bullet = bullet;

        const playSfx = vi
            .spyOn(getAudioEngine(), 'playSfx')
            .mockImplementation(() => Promise.resolve());
        const jumpOnHit = vi.spyOn(rightTank, 'jumpOnHit');

        // Достаточно кадров, чтобы все три очага доигрались до конца.
        for (let frame = 0; frame < 300 && gamePlay.bullet; frame += 1) {
            gamePlay.moveBullet(ctxStub);
        }

        // Три очага отыграны (снаряд убран), но раздача — ровно один раз.
        expect(gamePlay.bullet).toBeUndefined();
        expect(playSfx).toHaveBeenCalledWith('hit');
        expect(playSfx.mock.calls.filter((c) => c[0] === 'hit')).toHaveLength(1);
        expect(jumpOnHit).toHaveBeenCalledTimes(1);
        expect(callbacks.onTankHit).toHaveBeenCalledTimes(1);
    });

    it('промах кластера проигрывает "miss" один раз, но осыпает три кратера', () => {
        const { gamePlay, ground, leftTank, rightTank } = makeGamePlay();
        const bullet = new Bullet(
            WIDTH,
            HEIGHT,
            ground,
            leftTank,
            rightTank,
            0,
            WEAPON_SPECS[EWeaponKind.Cluster],
        );
        bullet.isTankHit = false;
        bullet.isHit = () => true;
        gamePlay.bullet = bullet;

        const playSfx = vi
            .spyOn(getAudioEngine(), 'playSfx')
            .mockImplementation(() => Promise.resolve());
        const fall = vi.spyOn(ground, 'fall');

        for (let frame = 0; frame < 300 && gamePlay.bullet; frame += 1) {
            gamePlay.moveBullet(ctxStub);
        }

        expect(playSfx.mock.calls.filter((c) => c[0] === 'miss')).toHaveLength(1);
        // Три очага — три кратера.
        expect(fall).toHaveBeenCalledTimes(3);
    });
});

/**
 * Взрыв обязан доигрываться до конца хода (ревью PR #601). Гейт кадра взрыва в
 * `moveBullet` спрашивал только `isHit(ctx)`, а `drawExplosion` обнуляет `radius`,
 * по которому этот же `isHit` и проверяет землю. Пока `move()` работал после
 * детонации, снаряд «дотапливался» гравитацией и гейт снова открывался; заморозка
 * снаряда (она чинит дрейф полосы очистки) этот механизм убрала — и бой вставал
 * навсегда: вспышка застывала, воронки не было, ход не передавался.
 *
 * Тесты гоняют ПУБЛИЧНЫЙ `moveBullet`, а не руками собранную последовательность
 * `move()` + `drawExplosion`: именно обход гейта и позволил зависанию проехать
 * мимо зелёного набора.
 */
describe('GamePlay.moveBullet — взрыв доигрывается до конца (ревью #601)', () => {
    /**
     * Снаряд ровно в кадре попадания: центр ВЫШЕ поверхности на свой радиус —
     * типичный случай (`isHit` срабатывает, когда до земли осталось не больше
     * радиуса). Именно на нём гейт и закрывался навсегда.
     */
    const setupImpact = (wind: number, kind = EWeaponKind.HighExplosive) => {
        const { gamePlay, ground, leftTank, rightTank } = makeGamePlay();
        const stub = new CtxStub();
        gamePlay.ctx = asCtx(stub);
        const bullet = new Bullet(
            WIDTH,
            HEIGHT,
            ground,
            leftTank,
            rightTank,
            wind,
            WEAPON_SPECS[kind],
        );
        const hitX = Math.floor(WIDTH / 2);
        bullet.x = hitX;
        // Порог попадания по земле — `innerHeight − y − radius ≤ heights[x]`, то есть
        // низ снаряда коснулся поверхности, а ЦЕНТР остался выше неё на радиус. Именно
        // на таком кадре гейт `isHit` закрывался навсегда, когда `drawExplosion`
        // обнулял радиус. Скорость обнулена: снаряд детонирует в этой самой точке.
        bullet.y = HEIGHT - ground.heights[hitX] - bullet.radius;
        bullet.dx = 0;
        bullet.dy = 0;
        gamePlay.bullet = bullet;
        return { gamePlay, ground, bullet, hitX, stub };
    };

    it.each([
        ['фугас', EWeaponKind.HighExplosive],
        ['кластер', EWeaponKind.Cluster],
    ])('%s: взрыв над поверхностью роет воронку и передаёт ход', (_name, kind) => {
        const { gamePlay, ground, bullet, stub } = setupImpact(0, kind);
        const fall = vi.spyOn(ground, 'fall');
        const spec = WEAPON_SPECS[kind];

        let frames = 0;
        while (gamePlay.bullet && frames < 1500) {
            gamePlay.moveBullet(asCtx(stub));
            frames += 1;
        }

        expect(frames, 'бой не доиграл выстрел за 1500 кадров').toBeLessThan(1500);
        expect(gamePlay.bullet, 'снаряд не сброшен — ход не передан').toBeUndefined();
        expect(bullet.isFinished).toBe(true);
        expect(bullet.focusIndex).toBe(spec.foci.length);
        expect(fall, 'воронка не вырыта').toHaveBeenCalledTimes(spec.foci.length);
    });

    it('воронка ложится в точку детонации, а не уезжает по ветру за время взрыва', () => {
        const { gamePlay, ground, bullet, stub } = setupImpact(-0.02);
        const fall = vi.spyOn(ground, 'fall');
        let detonationX: number | undefined;

        for (let frame = 0; frame < 1500 && gamePlay.bullet; frame += 1) {
            gamePlay.moveBullet(asCtx(stub));
            if (detonationX === undefined && bullet.detonated) detonationX = bullet.x;
        }

        // Гвард: снаряд обязан был детонировать, иначе сравнивать нечего.
        expect(detonationX).toBeDefined();
        expect(fall).toHaveBeenCalledTimes(1);
        const [craterX] = fall.mock.calls[0];
        expect(craterX, 'воронка уехала от точки детонации').toBe(detonationX);
    });
});

/**
 * Кадровый цикл целиком (`animate`), а не его куски: ветка точечной перерисовки
 * выбирается по состоянию боя, и выбор этот тестируется только отсюда. rAF и часы
 * подменены — цикл шагает ровно столько раз, сколько его позвали.
 */
describe('GamePlay.animate — ветка точечной перерисовки (ревью #601)', () => {
    /** Шагает кадровый цикл `frames` раз с шагом заведомо больше интервала кадра. */
    const drive = (gamePlay: GamePlay, frames: number) => {
        let now = 1000;
        const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
        const rafSpy = vi
            .spyOn(globalThis, 'requestAnimationFrame')
            .mockImplementation(() => 0 as unknown as number);
        try {
            for (let frame = 0; frame < frames; frame += 1) {
                now += 100;
                gamePlay.animate();
            }
        } finally {
            nowSpy.mockRestore();
            rafSpy.mockRestore();
        }
    };

    /** Бой в состоянии «земля осыпается от прошлой воронки, снаряд в воздухе». */
    const setupSettlingGround = () => {
        const { gamePlay, ground, bullet } = makeGamePlay();
        const stub = new CtxStub();
        gamePlay.ctx = asCtx(stub);
        ground.isFalling = true;
        // Между танками (200 и 600) — полоса взрыва не пересекается с их зонами
        // очистки, поэтому «полоса взрыва почищена» отличимо от «почищены танки».
        bullet.x = WIDTH / 2;
        bullet.y = HEIGHT / 3;
        bullet.dx = 0;
        bullet.dy = 0;
        gamePlay.bullet = bullet;
        return { gamePlay, bullet, stub };
    };

    /** Есть ли среди очищенных прямоугольников тот, что накрывает полосу целиком. */
    const bandCleared = (stub: CtxStub, from: number, to: number) =>
        stub.clearRects.some(([x, , w]) => x <= from && x + w >= to);

    it('снаряд ещё летит, а земля осыпается: полоса взрыва вокруг него НЕ чистится', () => {
        const { gamePlay, bullet, stub } = setupSettlingGround();
        const { from, to } = bullet.explosionRedrawRange;
        // Гвард: полоса заведомо широкая, иначе «не почищена» ничего не значит.
        expect(to - from).toBeGreaterThan(100);

        drive(gamePlay, 1);

        expect(bullet.detonated, 'снаряд не должен был детонировать').toBe(false);
        expect(stub.clearRects.length, 'кадр не прошёл по точечной перерисовке').toBeGreaterThan(0);
        expect(
            bandCleared(stub, from, to),
            `полоса взрыва [${from}, ${to}] чистится вокруг НЕ взорвавшегося снаряда`,
        ).toBe(false);
    });

    it('тот же кадр после детонации: полоса взрыва чистится — гейт не задушил живой путь', () => {
        const { gamePlay, bullet, stub } = setupSettlingGround();
        bullet.detonated = true;
        const { from, to } = bullet.explosionRedrawRange;

        drive(gamePlay, 1);

        expect(bandCleared(stub, from, to), 'полоса взрыва не почищена').toBe(true);
    });
});

describe('GamePlay — колбэки хода и ветра (handoff «Состояние»)', () => {
    it('changeActiveTank сообщает новую сторону хода после передачи хода', () => {
        const { gamePlay, callbacks } = makeGamePlay();

        gamePlay.changeActiveTank();

        expect(callbacks.onTurnChange).toHaveBeenCalledWith('enemy');

        gamePlay.changeActiveTank();

        expect(callbacks.onTurnChange).toHaveBeenLastCalledWith('player');
    });

    it('fire() сообщает начало выстрела (лок ввода/пилюля «ВЫСТРЕЛ»)', () => {
        const { gamePlay, callbacks, leftTank, rightTank, ground } = makeGamePlay();
        vi.spyOn(getAudioEngine(), 'playSfx').mockImplementation(() => Promise.resolve());

        gamePlay.fire(leftTank, rightTank, ground, WEAPON);

        expect(callbacks.onShotStart).toHaveBeenCalledTimes(1);
    });

    it('moveBullet сообщает конец выстрела ровно один раз, когда взрыв доигран', () => {
        const { gamePlay, callbacks, rightTank, bullet } = makeGamePlay();
        bullet.isTankHit = false;
        bullet.isHit = () => true;
        gamePlay.bullet = bullet;
        void rightTank;

        // explosionMaxRadius = 50: взрыв доигрывает 50 кадров, затем bullet
        // очищается и ход передаётся — до этого onShotEnd молчит.
        for (let frame = 0; frame < 49; frame += 1) {
            gamePlay.moveBullet(ctxStub);
        }
        expect(callbacks.onShotEnd).not.toHaveBeenCalled();

        gamePlay.moveBullet(ctxStub);

        expect(callbacks.onShotEnd).toHaveBeenCalledTimes(1);
        expect(gamePlay.bullet).toBeUndefined();
    });
});

describe('GamePlay — инсеты арены (контракт safe-зоны, #453)', () => {
    it('по умолчанию свободная зона равна всему полю (инсетов нет)', () => {
        const { gamePlay } = makeGamePlay();

        expect(gamePlay.arenaInsets).toEqual({ top: 0, bottom: 0 });
        expect(gamePlay.arenaZone).toEqual({ top: 0, height: HEIGHT });
    });

    it('setArenaInsets вычитает высоты оверлеев из свободной зоны', () => {
        const { gamePlay } = makeGamePlay();

        gamePlay.setArenaInsets({ top: 180, bottom: 120 });

        expect(gamePlay.arenaZone).toEqual({ top: 180, height: HEIGHT - 180 - 120 });
    });

    it('обновляется при изменении высоты любого оверлея', () => {
        const { gamePlay } = makeGamePlay();

        gamePlay.setArenaInsets({ top: 180, bottom: 120 });
        // Вырос нижний оверлей (подсказка жеста) — зона сжимается снизу.
        gamePlay.setArenaInsets({ top: 180, bottom: 160 });

        expect(gamePlay.arenaZone.height).toBe(HEIGHT - 180 - 160);
    });

    it('аномально большие инсеты не уводят высоту зоны в отрицательную', () => {
        const { gamePlay } = makeGamePlay();

        gamePlay.setArenaInsets({ top: HEIGHT, bottom: HEIGHT });

        expect(gamePlay.arenaZone.height).toBe(0);
        expect(gamePlay.arenaZone.height).toBeGreaterThanOrEqual(0);
    });

    it('НЕ перекладывает уже сгенерированный рельеф на смену инсетов (фидельность реплея, #454)', () => {
        // Нижний инсет штатно уменьшается после первого выстрела (уходит подсказка
        // жеста). Рельеф, сгенерированный под стартовый инсет и записанный в реплей,
        // не должен смещаться на лету — иначе живой бой разошёлся бы с записью.
        const { gamePlay, leftTank, ground } = makeGamePlay();
        const heightsBefore = [...ground.heights];
        const tankYBefore = leftTank.y;

        gamePlay.setArenaInsets({ top: 120, bottom: 90 });

        expect(ground.heights).toEqual(heightsBefore);
        expect(leftTank.y).toBe(tankYBefore);
        // Зона при этом всё равно пересчитана — движковый контракт safe-зоны (#453)
        // держит `arenaZone` актуальной, даже когда рельеф под неё не перекладывают.
        expect(gamePlay.arenaZone).toEqual({ top: 120, height: HEIGHT - 210 });
    });

    it('до генерации рельефа setArenaInsets только считает зону (рельефа ещё нет)', () => {
        const { gamePlay } = makeGamePlay();
        // Эмулируем состояние до initPaint: рельефа и танков нет.
        gamePlay.ground = undefined;
        gamePlay.leftTank = undefined;
        gamePlay.rightTank = undefined;

        expect(() => gamePlay.setArenaInsets({ top: 100, bottom: 100 })).not.toThrow();
        expect(gamePlay.arenaZone).toEqual({ top: 100, height: HEIGHT - 200 });
    });

    it('fit пересчитывает зону под новую высоту канваса (ресайз/поворот)', () => {
        // Без fixedLogicalSize fit читает реальный rect канваса — эмулируем поворот
        // через мутируемую высоту мока. (makeGamePlay фиксирует размер под реплей,
        // поэтому здесь собираем движок напрямую.)
        let rectHeight = 800;
        const canvas = {
            getBoundingClientRect: () => ({ width: 400, height: rectHeight }),
            width: 0,
            height: 0,
            offsetWidth: 400,
            offsetHeight: rectHeight,
        } as unknown as HTMLCanvasElement;
        const noopCallbacks: TGamePlayCallbacks = {
            onTankHit: vi.fn(),
            onGameOverCheck: vi.fn(),
            onMovesChange: vi.fn(),
            onPowerChange: vi.fn(),
            onBotReply: vi.fn(),
        };
        const gamePlay = new GamePlay(
            { current: canvas },
            { leftTankWeapons: [WEAPON], rightTankWeapons: [WEAPON] },
            noopCallbacks,
            createSeededRandom(1),
            createSeededRandom(2),
        );
        gamePlay.setArenaInsets({ top: 100, bottom: 100 });
        expect(gamePlay.arenaZone).toEqual({ top: 100, height: 600 });

        // Поворот: канвас стал ниже — fit подхватывает новую высоту, зона сжимается.
        rectHeight = 400;
        gamePlay.fit();

        expect(gamePlay.arenaZone).toEqual({ top: 100, height: 200 });
    });
});

describe('GamePlay — призрачная трасса прошлого выстрела (issue #543)', () => {
    /**
     * Стреляет `activeTank` → `targetTank` и прогоняет полёт до конца — попадание
     * форсировано на первом же кадре (как в тестах разрешения детонации выше), важен
     * не исход, а факт «выстрел долетел» (HighExplosive взрывается 50 кадров, см.
     * «moveBullet сообщает конец выстрела ровно один раз»).
     */
    function fireAndResolve(
        gamePlay: ReturnType<typeof makeGamePlay>['gamePlay'],
        activeTank: Tank,
        targetTank: Tank,
        ground: Ground,
    ) {
        gamePlay.fire(activeTank, targetTank, ground, WEAPON);
        const bullet = gamePlay.bullet;
        if (!bullet) throw new Error('fire() не создал снаряд');
        bullet.isTankHit = false;
        bullet.isHit = () => true;
        for (let frame = 0; frame < 60 && gamePlay.bullet; frame += 1) {
            gamePlay.moveBullet(ctxStub);
        }
        if (gamePlay.bullet) throw new Error('выстрел не долетел в бюджет кадров теста');
    }

    it('свой выстрел публикует свою трассу и не трогает трассу бота', () => {
        const { gamePlay, leftTank, rightTank, ground } = makeGamePlay();
        vi.spyOn(getAudioEngine(), 'playSfx').mockImplementation(() => Promise.resolve());

        expect(gamePlay.ownGhostTrail.isActive).toBe(false);
        expect(gamePlay.enemyGhostTrail.isActive).toBe(false);

        fireAndResolve(gamePlay, leftTank, rightTank, ground);

        expect(gamePlay.ownGhostTrail.isActive).toBe(true);
        expect(gamePlay.enemyGhostTrail.isActive).toBe(false);
    });

    it('следующий свой выстрел заменяет свою трассу — на арене не больше одной своей', () => {
        const { gamePlay, leftTank, rightTank, ground } = makeGamePlay();
        vi.spyOn(getAudioEngine(), 'playSfx').mockImplementation(() => Promise.resolve());

        fireAndResolve(gamePlay, leftTank, rightTank, ground);
        const firstShotTrail = gamePlay.ownGhostTrail.committedView;

        // Второй свой выстрел стартует из другого угла — записанный путь физически другой.
        leftTank.gunpointAngle -= 0.2;
        fireAndResolve(gamePlay, leftTank, rightTank, ground);

        expect(gamePlay.ownGhostTrail.isActive).toBe(true);
        expect(gamePlay.ownGhostTrail.committedView).not.toEqual(firstShotTrail);
    });

    it('выстрел бота публикует трассу бота и не трогает ещё не наступивший свой ход', () => {
        const { gamePlay, leftTank, rightTank, ground } = makeGamePlay();
        vi.spyOn(getAudioEngine(), 'playSfx').mockImplementation(() => Promise.resolve());

        fireAndResolve(gamePlay, rightTank, leftTank, ground);

        expect(gamePlay.enemyGhostTrail.isActive).toBe(true);
        expect(gamePlay.ownGhostTrail.isActive).toBe(false);
    });

    it('трасса бота гаснет ровно в конце вашего хода — когда долетел свой выстрел', () => {
        const { gamePlay, leftTank, rightTank, ground } = makeGamePlay();
        vi.spyOn(getAudioEngine(), 'playSfx').mockImplementation(() => Promise.resolve());

        fireAndResolve(gamePlay, rightTank, leftTank, ground);
        expect(gamePlay.enemyGhostTrail.isActive).toBe(true);

        fireAndResolve(gamePlay, leftTank, rightTank, ground);

        expect(gamePlay.enemyGhostTrail.isActive).toBe(false);
        expect(gamePlay.ownGhostTrail.isActive).toBe(true);
    });
});

/**
 * Погодный путь САМОГО движка (#546/#547 + разбор ревью PR !560).
 *
 * Раньше погоду сторожил только `weather-replay-determinism.test.ts` — а он гоняет
 * рукописную КОПИЮ оркестровки (`simulateWeatherBattleHp`), не `GamePlay`. Проверено
 * мутацией: убери из движка `applyWindModifier` — весь сьют оставался зелёным, потому
 * что ни один тест не создавал `GamePlay` с сидом, и погодная ветка была мертва.
 *
 * Здесь ветер читается с движка после `initPaint`: это единственное место, где
 * множитель реально применяется к бою.
 */
describe('GamePlay — ветер с поправкой погоды', () => {
    /** Сиды подобраны по `pickPrecipPreset`: у них устойчивый пресет. */
    const SNOW_SEED = 's12';
    const CLEAR_SEED = 's0';

    const windOf = (options: { seed?: number | string; weather?: boolean }): number => {
        const random = createSeededRandom(1);
        const game = new GamePlay(
            { current: null },
            { leftTankWeapons: [WEAPON], rightTankWeapons: [WEAPON] },
            {
                onTankHit: vi.fn(),
                onGameOverCheck: vi.fn(),
                onMovesChange: vi.fn(),
                onPowerChange: vi.fn(),
                onBotReply: vi.fn(),
                onTurnChange: vi.fn(),
                onShotStart: vi.fn(),
                onShotEnd: vi.fn(),
            },
            random,
            createSeededRandom(2),
            { fixedLogicalSize: { width: WIDTH, height: HEIGHT }, ...options },
        );
        game.initPaint();
        return game.wind;
    };

    it('снег домножает ветер боя — множитель применяет движок, а не только хелпер', () => {
        const snow = windOf({ seed: SNOW_SEED });
        const clear = windOf({ seed: CLEAR_SEED });
        // Оба сида дают свой рельеф и свой базовый ветер, поэтому сравниваем не числа, а
        // отношение к бою БЕЗ погоды на том же сиде: на снегу оно обязано быть 4/3.
        expect(snow / windOf({ seed: SNOW_SEED, weather: false })).toBeCloseTo(4 / 3, 10);
        expect(clear / windOf({ seed: CLEAR_SEED, weather: false })).toBeCloseTo(1, 10);
    });

    it('weather:false отключает погоду целиком — реплей старой записи идёт как записан', () => {
        // Ровно то, ради чего заведена версия формата v5: запись прошлой эпохи
        // воспроизводится с тем ветром, что был при записи, а не с сегодняшним.
        expect(windOf({ seed: SNOW_SEED, weather: false })).toBe(windOf({}));
    });
});

/**
 * Инвариант #550: флажок на башне своего танка показывает ТОТ ЖЕ ветер, что ячейка
 * «Ветер» в HUD. Держат его два вызова `setWindFlag` в движке — при старте боя и при
 * смене ветра бурей (#547), — и до этого теста ни один из них не был покрыт: все
 * сценарии флажка звали `tank.setWindFlag` руками, минуя `GamePlay`. Убери обе строки
 * из движка — сюита осталась бы зелёной, а в бою после бури флажок показывал бы старое
 * направление (ревью #550/#579). Идём поэтому боевым путём, а не через танк.
 */
describe('GamePlay — флажок ветра следует за ветром боя (#550)', () => {
    /** Первый сид с бурей: только у неё ветер меняется в середине боя (#547). */
    const stormSeed = (): number => {
        for (let seed = 1; seed < 5000; seed++) {
            if (pickPrecipPreset(seed).id === 'sandstorm') return seed;
        }
        throw new Error('Не найден сид с бурей');
    };

    const makeSeededGame = (seed: number) =>
        new GamePlay(
            { current: null },
            { leftTankWeapons: [WEAPON], rightTankWeapons: [WEAPON] },
            {
                onTankHit: vi.fn(),
                onGameOverCheck: vi.fn(),
                onMovesChange: vi.fn(),
                onPowerChange: vi.fn(),
                onBotReply: vi.fn(),
                onTurnChange: vi.fn(),
                onShotStart: vi.fn(),
                onShotEnd: vi.fn(),
            },
            createSeededRandom(1),
            createSeededRandom(2),
            { fixedLogicalSize: { width: WIDTH, height: HEIGHT }, seed },
        );

    /** Флажок танка, каким его обязан видеть HUD при этом ветре. */
    const expectFlagMatchesWind = (game: GamePlay) => {
        expect(game.leftTank?.windFlagRotationRad).toBeCloseTo(windFlagRotationRad(game.wind), 12);
        expect(game.leftTank?.windFlagSide).toBe(windFlagSide(game.wind));
    };

    /** Один доигранный до конца выстрел: попадание решено промахом, взрыв досчитан. */
    const completeShot = (game: GamePlay) => {
        const bullet = new Bullet(WIDTH, HEIGHT, game.ground!, game.leftTank!, game.rightTank!, 0);
        bullet.isTankHit = false;
        bullet.isHit = () => true;
        game.bullet = bullet;
        // explosionMaxRadius = 50 кадров, как в тестах разрешения попадания выше.
        for (let frame = 0; frame < 51 && game.bullet; frame += 1) {
            game.moveBullet(ctxStub);
        }
    };

    it('в начале боя флажок выставлен по боевому ветру, а не по нулю', () => {
        const game = makeSeededGame(stormSeed());
        game.initPaint();

        expect(game.wind).not.toBe(0);
        expectFlagMatchesWind(game);
    });

    it('после смены ветра бурей флажок разворачивается вместе с ячейкой «Ветер»', () => {
        vi.spyOn(getAudioEngine(), 'playSfx').mockImplementation(() => Promise.resolve());
        const game = makeSeededGame(stormSeed());
        game.initPaint();
        const windBefore = game.wind;
        const flagBefore = game.leftTank?.windFlagRotationRad;

        for (let shot = 0; shot < STORM_WIND_SHIFT_AFTER_SHOTS; shot += 1) completeShot(game);

        // Гвард от вырождения: не сменился ветер — тест сторожил бы «флажок не тронули».
        expect(game.wind, 'буря обязана сменить ветер после трёх выстрелов').not.toBe(windBefore);
        expect(game.leftTank?.windFlagRotationRad).not.toBe(flagBefore);
        expectFlagMatchesWind(game);
    });
});

/**
 * Регресс #571, разобранный в #580: тень выросла, а зона частичной перерисовки
 * осталась литералом `padding = 50`. Наружу это вышло тремя симптомами одной
 * причины — след за движущимся танком, накопление альфы под танком во время
 * осыпания земли после взрыва и полоса на закате. Тесты ниже сторожат САМУ
 * СВЯЗЬ: тень рисуется и стирается одной и той же геометрией, поэтому вырасти
 * мимо зоны очистки она больше не может.
 */
describe('GamePlay — зона очистки покрывает габарит тени танка (#580)', () => {
    /** Свет у горизонта (закат) — худший случай смещения тени по горизонтали. */
    const SUNSET_LIGHT = { dx: -1, dy: 0.05 };

    /**
     * Один кадр точечной перерисовки танков: то, что зовёт кадровый цикл.
     *
     * Приватный метод вскрыт кастом сознательно (ревью #601 против этого возражал, и
     * возражение справедливо в общем случае). Публичный вход — `animate` — здесь не
     * подходит: он сам выбирает ветку кадра, и заявленное тестом состояние («идёт
     * осыпание, тень перерисовывается каждый кадр») достижимо в нём только вместе с
     * частицами, которые уводят кадр в `fullRedraw`. Дыру, из-за которой каст был
     * опасен, закрыли отдельные тесты на публичном `moveBullet` и `animate` выше.
     */
    const redrawTanks = (gamePlay: GamePlay) => {
        (gamePlay as unknown as { tankAreaRedraw(tanks: Tank[]): void }).tankAreaRedraw([
            gamePlay.leftTank!,
            gamePlay.rightTank!,
        ]);
    };

    const setupWithShadows = (lightDx: number) => {
        const { gamePlay, leftTank, rightTank } = makeGamePlay();
        const stub = new CtxStub();
        gamePlay.ctx = asCtx(stub);
        const shadow = {
            direction: { dx: lightDx, dy: SUNSET_LIGHT.dy },
            color: 'rgba(12, 10, 8, 0.32)',
        };
        leftTank.shadow = shadow;
        rightTank.shadow = shadow;
        return { gamePlay, stub };
    };

    /** Полностью ли горизонтальный отрезок тени накрыт одной из очищенных полос. */
    const coveredByClear = (stub: CtxStub, left: number, right: number) =>
        stub.clearRects.some(([x, , w]) => x <= left && x + w >= right);

    it.each([
        ['светило слева (тень уезжает вправо)', 1],
        ['светило справа (тень уезжает влево)', -1],
    ])('%s: эллипс тени целиком внутри очищенной полосы', (_name, lightDx) => {
        const { gamePlay, stub } = setupWithShadows(lightDx);

        redrawTanks(gamePlay);

        // Гвард от вырождения: нет теней — тест сторожил бы пустоту.
        expect(stub.ellipses.length, 'оба танка обязаны нарисовать тень').toBe(2);
        for (const [x, , radiusX] of stub.ellipses) {
            expect(
                coveredByClear(stub, x - radiusX, x + radiusX),
                `тень [${x - radiusX}, ${x + radiusX}] не покрыта ни одной очищенной полосой`,
            ).toBe(true);
        }
    });

    it('связь держится и на раздутой тени — зона едет за габаритом, а не стоит на 50', () => {
        const { gamePlay, stub } = setupWithShadows(-1);
        // Корпус вчетверо шире канона: вылет тени (0.28 ширины) перерастает
        // исторический запас на декор. Если зона очистки вернётся к литералу,
        // тень вылезет за полосу — и тест покраснеет раньше, чем сцена.
        gamePlay.leftTank!.tankWidth = 400;
        gamePlay.rightTank!.tankWidth = 400;

        redrawTanks(gamePlay);

        expect(stub.ellipses).toHaveLength(2);
        for (const [x, , radiusX] of stub.ellipses) {
            expect(coveredByClear(stub, x - radiusX, x + radiusX)).toBe(true);
        }
    });

    it('осыпание земли после взрыва не копит альфу: каждый кадр тень стирается целиком', () => {
        const { gamePlay, stub } = setupWithShadows(-1);

        // Десять кадров подряд, как во время `ground.isFalling`: тень рисуется
        // заново каждый кадр, и каждый раз поверх ОЧИЩЕННОГО места.
        for (let frame = 0; frame < 10; frame += 1) {
            stub.clearRects.length = 0;
            stub.ellipses.length = 0;
            redrawTanks(gamePlay);
            expect(stub.ellipses).toHaveLength(2);
            for (const [x, , radiusX] of stub.ellipses) {
                expect(coveredByClear(stub, x - radiusX, x + radiusX)).toBe(true);
            }
        }
    });
});

/**
 * Грязь после взрыва (issue #582): очистка, рельеф и габарит спрайта считались в
 * `explosionAreaRedraw` тремя разными выражениями. Тесты ниже сторожат СВЯЗЬ —
 * `clearRect` и `ground.draw` берут одну пару координат, и вся вспышка (включая
 * кончики лучей и смещённые очаги кластера) рисуется внутри очищенной полосы.
 */
describe('GamePlay — зона очистки покрывает габарит взрыва (#582)', () => {
    /**
     * Один кадр точечной перерисовки взрыва: то, что зовёт кадровый цикл. Каст в
     * приватное — по той же причине, что и у `redrawTanks` выше: живой кадр взрыва
     * идёт с частицами, а те уводят цикл в `fullRedraw`, где полосы нет вовсе.
     */
    const redrawExplosion = (gamePlay: GamePlay, bullet: Bullet) =>
        (gamePlay as unknown as { explosionAreaRedraw(bullet: Bullet): void }).explosionAreaRedraw(
            bullet,
        );

    /**
     * Настраивает бой с уже детонировавшим снарядом нужного типа.
     *
     * `wind` — параметр, а не ноль по умолчанию во всех сценариях: при нулевом ветре
     * снаряд стоит на месте по любой реализации, и тест «полоса не двигается» выходит
     * vacuous. Дрейф после детонации ловится только ненулевым ветром (см. тест ниже).
     */
    const setupExplosion = (kind: EWeaponKind, wind = 0) => {
        const { gamePlay, ground, leftTank, rightTank } = makeGamePlay();
        const stub = new CtxStub();
        gamePlay.ctx = asCtx(stub);
        const bullet = new Bullet(
            WIDTH,
            HEIGHT,
            ground,
            leftTank,
            rightTank,
            wind,
            WEAPON_SPECS[kind],
        );
        // Точка попадания — середина арены: полоса взрыва целиком внутри канваса,
        // и клампы `blitLayer` не прячут расхождение краёв.
        bullet.x = WIDTH / 2;
        bullet.y = HEIGHT / 2;
        bullet.detonated = true;
        gamePlay.bullet = bullet;
        return { gamePlay, ground, bullet, stub };
    };

    it.each([
        [EWeaponKind.HighExplosive],
        [EWeaponKind.Heavy],
        [EWeaponKind.Cluster],
        [EWeaponKind.Digger],
    ])('%s: clearRect и ground.draw берут ОДИН диапазон', (kind) => {
        const { gamePlay, ground, bullet, stub } = setupExplosion(kind);
        // Взрыв уже раскрылся: на нулевом радиусе прежняя (битая) пара выражений
        // случайно совпадала, и тест сторожил бы совпадение, а не связь.
        for (let frame = 0; frame < 5; frame += 1) {
            bullet.drawExplosion(asCtx(stub));
        }
        expect(bullet.explosionRadius).toBeGreaterThan(0);
        const drawSpy = vi.spyOn(ground, 'draw');

        redrawExplosion(gamePlay, bullet);

        expect(stub.clearRects).toHaveLength(1);
        const [clearX, , clearWidth] = stub.clearRects[0];
        expect(clearWidth).toBeGreaterThan(0);
        expect(drawSpy).toHaveBeenCalledTimes(1);
        const [, from, to] = drawSpy.mock.calls[0];
        expect(from).toBe(clearX);
        // Именно здесь жил дефект: `ground.draw` получал ширину как координату
        // правого края и рисовал песок на радиус правее очищенного.
        expect(to).toBe(clearX + clearWidth);
    });

    it.each([
        [EWeaponKind.HighExplosive],
        [EWeaponKind.Heavy],
        [EWeaponKind.Cluster],
        [EWeaponKind.Digger],
    ])('%s: каждый пиксель вспышки нарисован внутри очищенной полосы', (kind) => {
        const { gamePlay, bullet, stub } = setupExplosion(kind);

        let painted = 0;
        // Кадр за кадром весь взрыв: очистка полосы, затем отрисовка очага — тот же
        // порядок, что в кадровом цикле (`explosionAreaRedraw` → `moveBullet`).
        for (let frame = 0; frame < 400 && !bullet.isFinished; frame += 1) {
            stub.clearRects.length = 0;
            stub.fillRects.length = 0;
            redrawExplosion(gamePlay, bullet);
            bullet.drawExplosion(asCtx(stub));

            const [clearX, , clearWidth] = stub.clearRects[0];
            for (const [x, , w] of stub.fillRects) {
                painted += 1;
                expect(
                    x >= clearX && x + w <= clearX + clearWidth,
                    `пиксель [${x}, ${x + w}] вне очищенной полосы [${clearX}, ${clearX + clearWidth}]`,
                ).toBe(true);
            }
        }

        // Гвард от вырождения: взрыв обязан был что-то нарисовать.
        expect(painted).toBeGreaterThan(100);
        expect(bullet.isFinished).toBe(true);
    });

    it('кластер: полоса стоит на месте все три очага, а не прыгает за смещённым', () => {
        const { gamePlay, bullet, stub } = setupExplosion(EWeaponKind.Cluster);

        const bands = new Set<string>();
        for (let frame = 0; frame < 400 && !bullet.isFinished; frame += 1) {
            stub.clearRects.length = 0;
            redrawExplosion(gamePlay, bullet);
            bullet.drawExplosion(asCtx(stub));
            const [clearX, , clearWidth] = stub.clearRects[0];
            bands.add(`${clearX}:${clearWidth}`);
        }

        // Гвард: очаги действительно отыграны все три.
        expect(bullet.focusIndex).toBe(WEAPON_SPECS[EWeaponKind.Cluster].foci.length);
        expect(bands.size, `полоса меняла границы: ${[...bands].join(', ')}`).toBe(1);
    });

    // Кадровый цикл целиком: `GamePlay.moveBullet` зовёт `move()` ПЕРВЫМ и каждый кадр,
    // в том числе после детонации, а `drawExplosion` обнуляет `dx/dy` уже после него.
    // Тесты выше этого не воспроизводили и потому не могли поймать дрейф: они гоняют
    // только отрисовку, да ещё при нулевом ветре. Ветер обоих знаков — потому что
    // усечение `| 0` работает к нулю, и знак меняет, на каком кадре уедет координата.
    it.each([-0.02, 0.02])(
        'снаряд не дрейфует после детонации (ветер %s): центр и полоса стоят весь взрыв',
        (wind) => {
            const { gamePlay, bullet, stub } = setupExplosion(EWeaponKind.Cluster, wind);
            const startX = bullet.x;
            const bands = new Set<string>();

            for (let frame = 0; frame < 400 && !bullet.isFinished; frame += 1) {
                stub.clearRects.length = 0;
                bullet.move();
                redrawExplosion(gamePlay, bullet);
                bullet.drawExplosion(asCtx(stub));
                const [clearX, , clearWidth] = stub.clearRects[0];
                bands.add(`${clearX}:${clearWidth}`);
            }

            expect(bullet.x, 'координата снаряда уехала за время взрыва').toBe(startX);
            expect(bands.size, `полоса меняла границы: ${[...bands].join(', ')}`).toBe(1);
            expect(bullet.focusIndex).toBe(WEAPON_SPECS[EWeaponKind.Cluster].foci.length);
        },
    );
});
