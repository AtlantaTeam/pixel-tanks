import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { floor } from '@/shared/lib/canvas';
import type { TWeapon } from '@/shared/model';
import { decodeReplay, encodeReplay, type TReplay } from '@/entities/replays';
import { Ground } from './ground';
import { Tank } from './tank';
import { Bullet } from './bullet';
import { generateWind } from './wind';
import { resolvePointsDelta } from './score';

/**
 * Тест детерминизма реплея (Issue #37): сериализованный бой при воспроизведении
 * даёт идентичный итоговый счёт.
 *
 * Полноценно прогнать `GamePlay` headless нельзя — в happy-dom
 * `canvas.getContext('2d')` возвращает `null`, значит весь путь рендера и
 * Path2D-проверки попаданий отсутствует. Поэтому здесь собран компактный
 * прогон боя на ТЕХ ЖЕ реальных строительных блоках движка, что и живая игра:
 * `createSeededRandom` → `Ground` + `generateWind` (в том же порядке, что и
 * `GamePlay.initPaint`), физика `Bullet`, попадание в `Tank.tankHitArea`,
 * начисление очков `resolvePointsDelta`. Косметика (частицы, тряска, slow-mo)
 * на счёт не влияет и опущена.
 *
 * Свойство, которое проверяется: (seed + ходы игрока) → счёт — чистая функция.
 * Именно на этом стоит вся фича реплеев (в записи только seed и ходы игрока,
 * см. `@/entities/replays`), поэтому идентичность двух прогонов и прогона
 * ПОСЛЕ `encode → decode` доказывает, что ссылка воспроизводит бой один в один.
 */

const WIDTH = 800;
const HEIGHT = 600;
const WEAPON: TWeapon = { id: 0, name: 'Снаряд' };
/** Предел шагов симуляции снаряда — страховка от зацикливания, не игровой лимит. */
const MAX_BULLET_STEPS = 20000;

// happy-dom не предоставляет Path2D. Заглушка хранит прямоугольник области
// попадания танка и умеет проверять точку — ровно то, что читает Bullet.checkTankHit.
class Path2DStub {
    private rectArgs: [number, number, number, number] = [0, 0, 0, 0];
    rect(x: number, y: number, w: number, h: number) {
        this.rectArgs = [x, y, w, h];
    }
    addPath() {}
    contains(px: number, py: number): boolean {
        const [x, y, w, h] = this.rectArgs;
        return px >= x && px <= x + w && py >= y && py <= y + h;
    }
}

beforeAll(() => {
    if (typeof globalThis.Path2D === 'undefined') {
        vi.stubGlobal('Path2D', Path2DStub);
    }
});

// Танки на реальном рельефе не наклоняются (currentTransformer остаётся undefined),
// поэтому ctx нужен только для Path2D-проверки: остальные вызовы — no-op.
const ctxStub = {
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    isPointInPath: (path: Path2DStub, x: number, y: number) => path.contains(x, y),
} as unknown as CanvasRenderingContext2D;

// Область попадания танка = его прямоугольник, как в Tank.draw. Пересобираем перед
// каждым выстрелом, чтобы она следовала за танком после перемещений.
const refreshHitArea = (tank: Tank) => {
    const path = new Path2DStub();
    path.rect(floor(tank.x), floor(tank.y - 30), tank.tankWidth, tank.tankHeight);
    tank.tankHitArea = path as unknown as Path2D;
};

type TScore = { playerPoints: number; enemyPoints: number };

/**
 * Headless-прогон записанного боя: воспроизводит ходы игрока (левый танк) на
 * seeded-рельефе и ветре, стреляет реальным `Bullet` и начисляет очки так же,
 * как движок в `GamePlay.moveBullet`. Возвращает итоговый счёт.
 */
const simulateReplayScore = (replay: TReplay): TScore => {
    // Порядок расхода RNG совпадает с GamePlay.initPaint: сначала рельеф, потом ветер.
    const random = createSeededRandom(replay.seed);
    const ground = new Ground(WIDTH, HEIGHT, random);
    const wind = generateWind(random);

    const leftX = floor(WIDTH / 4);
    const rightX = floor((WIDTH * 3) / 4);
    const player = new Tank(leftX, HEIGHT - ground.heights[leftX], WIDTH, HEIGHT, 0, [WEAPON]);
    player.isActive = true;
    const enemy = new Tank(rightX, HEIGHT - ground.heights[rightX], WIDTH, HEIGHT, Math.PI, [
        WEAPON,
    ]);

    const score: TScore = { playerPoints: 0, enemyPoints: 0 };

    for (const move of replay.moves) {
        if (move.kind === 'move') {
            // Чистый эффект слайда танка (Tank.move переносит на delta по кадрам),
            // с тем же клампом «не выходить за края поля».
            const nextX = player.x + move.delta;
            player.x = Math.max(1, Math.min(nextX, WIDTH - player.tankWidth - 1));
            continue;
        }

        player.gunpointAngle = move.angle;
        player.power = move.power;
        refreshHitArea(player);
        refreshHitArea(enemy);

        const bullet = new Bullet(WIDTH, HEIGHT, ground, player, enemy, wind);
        let steps = 0;
        bullet.move();
        while (!bullet.isHit(ctxStub) && steps < MAX_BULLET_STEPS) {
            bullet.move();
            steps += 1;
        }

        if (bullet.isTankHit && bullet.hittedTank) {
            const { isPlayer, delta } = resolvePointsDelta({
                hittedIsLeft: bullet.hittedTank === player,
                leftActive: player.isActive,
                power: bullet.power,
            });
            if (isPlayer) score.playerPoints += delta;
            else score.enemyPoints += delta;
        }
    }

    return score;
};

const fire = (angle: number, power: number) => ({ kind: 'fire' as const, angle, power });
const move = (delta: number) => ({ kind: 'move' as const, delta });

// Выстрел, гарантированно попадающий по вражескому танку на этом seed (подобран
// перебором), — чтобы счёт был ненулевым и тест не выродился в «0 === 0».
const HITTING_BATTLE: TReplay = {
    seed: 42,
    moves: [fire(-0.895, 8)],
};

describe('детерминизм реплея: сериализованный бой → идентичный счёт', () => {
    it('попадающий бой даёт ненулевой счёт игрока (тест не вырожденный)', () => {
        const score = simulateReplayScore(HITTING_BATTLE);

        expect(score.playerPoints).toBeGreaterThan(0);
    });

    it('счёт после encode → decode идентичен оригиналу', () => {
        const decoded = decodeReplay(encodeReplay(HITTING_BATTLE));
        expect(decoded).not.toBeNull();

        expect(simulateReplayScore(decoded!)).toEqual(simulateReplayScore(HITTING_BATTLE));
    });

    it('два независимых прогона одной записи дают идентичный счёт', () => {
        expect(simulateReplayScore(HITTING_BATTLE)).toEqual(simulateReplayScore(HITTING_BATTLE));
    });

    it.each<[string, TReplay]>([
        ['числовой seed, только выстрелы', { seed: 42, moves: [fire(-0.895, 8), fire(-0.5, 14)] }],
        ['строковый seed', { seed: 'daily-2026-07-19', moves: [fire(-0.96, 7)] }],
        [
            'перемещения между выстрелами',
            { seed: 7, moves: [move(-40), fire(-0.96, 7), move(60), fire(-0.7, 11)] },
        ],
        ['бой без ходов', { seed: 100, moves: [] }],
        ['промах (счёт остаётся 0)', { seed: 42, moves: [fire(-1.4, 3)] }],
    ])('идентичный счёт после сериализации: %s', (_label, replay) => {
        const decoded = decodeReplay(encodeReplay(replay));
        expect(decoded).not.toBeNull();

        expect(simulateReplayScore(decoded!)).toEqual(simulateReplayScore(replay));
    });

    it('разные seed при тех же ходах, как правило, дают разный бой (счёт зависит от seed)', () => {
        // Записи с одинаковыми ходами, но разными seed: рельеф/ветер отличаются,
        // поэтому исход выстрела не обязан совпасть — иначе seed ни на что не влиял бы.
        const scores = [1, 2, 3, 4, 5].map((seed) =>
            JSON.stringify(simulateReplayScore({ seed, moves: [fire(-0.895, 8), fire(-0.6, 12)] })),
        );

        expect(new Set(scores).size).toBeGreaterThan(1);
    });

    it('угол float64 не квантуется: соседние углы сериализуются раздельно', () => {
        const a: TReplay = { seed: 42, moves: [fire(-0.8950000000000001, 8)] };
        const b: TReplay = { seed: 42, moves: [fire(-0.895, 8)] };

        // Оба угла проходят encode → decode бит-в-бит (см. replay-codec), значит их
        // прогоны воспроизводятся точно каждый по себе.
        expect(simulateReplayScore(decodeReplay(encodeReplay(a))!)).toEqual(simulateReplayScore(a));
        expect(simulateReplayScore(decodeReplay(encodeReplay(b))!)).toEqual(simulateReplayScore(b));
    });
});
