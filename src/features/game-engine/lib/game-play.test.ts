import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { getAudioEngine } from '@/shared/lib/audio';
import { EWeaponKind, type TWeapon } from '@/shared/model';
import { GamePlay, type TGamePlayCallbacks } from './game-play';
import { Ground } from './ground';
import { Tank } from './tank';
import { Bullet } from './bullet';
import { WEAPON_SPECS } from './weapon-specs';

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
