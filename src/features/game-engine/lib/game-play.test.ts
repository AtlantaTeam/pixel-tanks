import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { getAudioEngine } from '@/shared/lib/audio';
import type { TWeapon } from '@/shared/model';
import { GamePlay, type TGamePlayCallbacks } from './game-play';
import { Ground } from './ground';
import { Tank } from './tank';
import { Bullet } from './bullet';

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
const WEAPON: TWeapon = { id: 0, name: 'Снаряд' };

/**
 * Собирает `GamePlay` с двумя танками и грунтом, готовый к прогону `moveBullet`.
 * Снаряд создаётся, но не подставляется — сценарий (попадание/промах) настраивает
 * его сам, поэтому bullet и оба танка возвращаются наружу.
 */
function makeGamePlay() {
    const callbacks: TGamePlayCallbacks = {
        onPointsCalc: vi.fn(),
        onGameOverCheck: vi.fn(),
        onMovesChange: vi.fn(),
        onPowerChange: vi.fn(),
        onBotReply: vi.fn(),
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

    return { gamePlay, callbacks, leftTank, rightTank, bullet };
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
        expect(callbacks.onPointsCalc).toHaveBeenCalledTimes(1);
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
        expect(callbacks.onPointsCalc).not.toHaveBeenCalled();
    });
});
