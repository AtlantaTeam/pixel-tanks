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

// drawExplosion рисует градиент и дугу, draw() — прямоугольник снаряда:
// содержимое не проверяем, важно только что вызовы не падают.
const ctxStub = {
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    closePath: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
    fillStyle: '',
} as unknown as CanvasRenderingContext2D;

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
    /** ctx-заглушка: журнал `clearRect` (зона очистки) и `ellipse` (тень). */
    class RedrawCtxStub {
        fillStyle = '';
        strokeStyle = '';
        lineWidth = 0;
        lineJoin = 'miter';
        clearRects: number[][] = [];
        ellipses: number[][] = [];

        clearRect(x: number, y: number, w: number, h: number) {
            this.clearRects.push([x, y, w, h]);
        }
        ellipse(x: number, y: number, rx: number, ry: number) {
            this.ellipses.push([x, y, rx, ry]);
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
        getTransform() {
            return new DOMMatrix();
        }
        drawImage() {}
        fillRect() {}
        fill() {}
        stroke() {}
        createPattern() {
            return null;
        }
        createRadialGradient() {
            return { addColorStop: () => undefined };
        }
    }

    /** Свет у горизонта (закат) — худший случай смещения тени по горизонтали. */
    const SUNSET_LIGHT = { dx: -1, dy: 0.05 };

    /** Один кадр точечной перерисовки танков: то, что зовёт кадровый цикл. */
    const redrawTanks = (gamePlay: GamePlay) => {
        (gamePlay as unknown as { tankAreaRedraw(tanks: Tank[]): void }).tankAreaRedraw([
            gamePlay.leftTank!,
            gamePlay.rightTank!,
        ]);
    };

    const setupWithShadows = (lightDx: number) => {
        const { gamePlay, leftTank, rightTank } = makeGamePlay();
        const stub = new RedrawCtxStub();
        gamePlay.ctx = stub as unknown as CanvasRenderingContext2D;
        const shadow = {
            direction: { dx: lightDx, dy: SUNSET_LIGHT.dy },
            color: 'rgba(12, 10, 8, 0.32)',
        };
        leftTank.shadow = shadow;
        rightTank.shadow = shadow;
        return { gamePlay, stub };
    };

    /** Полностью ли горизонтальный отрезок тени накрыт одной из очищенных полос. */
    const coveredByClear = (stub: RedrawCtxStub, left: number, right: number) =>
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
