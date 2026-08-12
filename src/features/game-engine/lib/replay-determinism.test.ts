import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { floor } from '@/shared/lib/canvas';
import type { TWeapon } from '@/shared/model';
import { decodeReplay, encodeReplay, type TReplay } from '@/entities/replays';
import { MAX_HP } from '@/shared/config';
import { EMPTY_ARENA_INSETS } from './arena-insets';
import { Ground } from './ground';
import { Tank } from './tank';
import { Bullet } from './bullet';
import { generateWind } from './wind';

/**
 * Тест детерминизма реплея (Issue #37): сериализованный бой при воспроизведении
 * даёт идентичный итоговый HP сторон.
 *
 * Полноценно прогнать `GamePlay` headless нельзя — в happy-dom
 * `canvas.getContext('2d')` возвращает `null`, значит весь путь рендера и
 * Path2D-проверки попаданий отсутствует. Поэтому здесь собран компактный
 * прогон боя на ТЕХ ЖЕ реальных строительных блоках движка, что и живая игра:
 * `createSeededRandom` → `Ground` + `generateWind` (в том же порядке, что и
 * `GamePlay.initPaint`), физика `Bullet`, попадание в `Tank.tankHitArea`, урон
 * по HP той стороны, в которую попали (HP-модель, GDD §2.5 — как
 * `game-canvas` в `onTankHit`: `applyDamage(hittedIsLeft ? 'player' :
 * 'enemy', power)`). Косметика (частицы, тряска, slow-mo) на HP не влияет и
 * опущена.
 *
 * Свойство, которое проверяется: (seed + ходы игрока) → итоговый HP — чистая
 * функция. Именно на этом стоит вся фича реплеев (в записи только seed и ходы
 * игрока, см. `@/entities/replays`), поэтому идентичность двух прогонов и прогона
 * ПОСЛЕ `encode → decode` доказывает, что ссылка воспроизводит бой один в один.
 */

const WIDTH = 800;
const HEIGHT = 600;
const WEAPON: TWeapon = { id: 0, name: 'Снаряд' };

/** Собирает запись боя с размером поля по умолчанию (800×600). */
const battle = (seed: number | string, moves: TReplay['moves']): TReplay => ({
    seed,
    width: WIDTH,
    height: HEIGHT,
    moves,
});
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

type THp = { playerHp: number; enemyHp: number };

/** Держит HP в границах боя (0..MAX_HP), как `clampHp` в `game.store`. */
const clampHp = (hp: number) => Math.min(MAX_HP, Math.max(0, hp));

/**
 * Headless-прогон записанного боя: воспроизводит ходы игрока (левый танк) на
 * seeded-рельефе и ветре, стреляет реальным `Bullet` и снимает урон с HP той
 * стороны, в которую попали — так же, как движок в `GamePlay.moveBullet` +
 * `game-canvas.onTankHit`. Возвращает итоговый HP сторон.
 */
const simulateBattleHp = (replay: TReplay): THp => {
    // Физика идёт на логическом размере записи — как воспроизведение реплея.
    const width = replay.width;
    const height = replay.height;
    // Порядок расхода RNG совпадает с GamePlay.initPaint: сначала рельеф, потом ветер.
    const random = createSeededRandom(replay.seed);
    // Рельеф генерится внутри safe-зоны записи (#454): те же инсеты, что при живом
    // бою, — иначе рельеф и счёт разошлись бы. Записи без инсетов → зона = весь канвас.
    const ground = new Ground(
        width,
        height,
        random,
        undefined,
        replay.insets ?? EMPTY_ARENA_INSETS,
    );
    const wind = generateWind(random);

    const leftX = floor(width / 4);
    const rightX = floor((width * 3) / 4);
    const player = new Tank(leftX, height - ground.heights[leftX], width, height, 0, [WEAPON]);
    player.isActive = true;
    const enemy = new Tank(rightX, height - ground.heights[rightX], width, height, Math.PI, [
        WEAPON,
    ]);

    const hp: THp = { playerHp: MAX_HP, enemyHp: MAX_HP };

    for (const move of replay.moves) {
        if (move.kind === 'move') {
            // Гоняем настоящий Tank.move (тот же кламп краёв, что и в движке),
            // а не переоткрываем логику перемещения — иначе тест «на тех же
            // строительных блоках» не выполнялся бы для перемещения.
            player.dx = move.delta;
            while (player.dx) player.move();
            continue;
        }

        player.gunpointAngle = move.angle;
        player.power = move.power;
        refreshHitArea(player);
        refreshHitArea(enemy);

        const bullet = new Bullet(width, height, ground, player, enemy, wind);
        let steps = 0;
        bullet.move();
        while (!bullet.isHit(ctxStub) && steps < MAX_BULLET_STEPS) {
            bullet.move();
            steps += 1;
        }

        if (bullet.isTankHit && bullet.hittedTank) {
            // Попадание снимает урон оружия с HP задетой стороны (левый — игрок).
            if (bullet.hittedTank === player) {
                hp.playerHp = clampHp(hp.playerHp - bullet.power);
            } else {
                hp.enemyHp = clampHp(hp.enemyHp - bullet.power);
            }
        }
    }

    return hp;
};

const fire = (angle: number, power: number) => ({ kind: 'fire' as const, angle, power });
const move = (delta: number) => ({ kind: 'move' as const, delta });

// Выстрел, гарантированно попадающий по вражескому танку на этом seed (подобран
// перебором), — чтобы урон был ненулевым и тест не выродился в «100 === 100».
const HITTING_BATTLE: TReplay = battle(42, [fire(-0.895, 8)]);

describe('детерминизм реплея: сериализованный бой → идентичный итоговый HP', () => {
    it('попадающий бой снимает HP противника (тест не вырожденный)', () => {
        const hp = simulateBattleHp(HITTING_BATTLE);

        expect(hp.enemyHp).toBeLessThan(MAX_HP);
    });

    it('итоговый HP после encode → decode идентичен оригиналу', () => {
        const decoded = decodeReplay(encodeReplay(HITTING_BATTLE));
        expect(decoded).not.toBeNull();

        expect(simulateBattleHp(decoded!)).toEqual(simulateBattleHp(HITTING_BATTLE));
    });

    it('два независимых прогона одной записи дают идентичный HP', () => {
        expect(simulateBattleHp(HITTING_BATTLE)).toEqual(simulateBattleHp(HITTING_BATTLE));
    });

    it.each<[string, TReplay]>([
        ['числовой seed, только выстрелы', battle(42, [fire(-0.895, 8), fire(-0.5, 14)])],
        ['строковый seed', battle('daily-2026-07-19', [fire(-0.96, 7)])],
        [
            'перемещения между выстрелами',
            battle(7, [move(-40), fire(-0.96, 7), move(60), fire(-0.7, 11)]),
        ],
        ['бой без ходов', battle(100, [])],
        ['промах (HP остаётся полным)', battle(42, [fire(-1.4, 3)])],
    ])('идентичный HP после сериализации: %s', (_label, replay) => {
        const decoded = decodeReplay(encodeReplay(replay));
        expect(decoded).not.toBeNull();

        expect(simulateBattleHp(decoded!)).toEqual(simulateBattleHp(replay));
    });

    it('запись с инсетами safe-зоны воспроизводится идентично после encode → decode', () => {
        const withInsets: TReplay = {
            seed: 42,
            width: 390,
            height: 844,
            insets: { top: 140, bottom: 150 },
            moves: [fire(-0.9, 8), move(-150), fire(-0.6, 12)],
        };
        const decoded = decodeReplay(encodeReplay(withInsets));
        expect(decoded).not.toBeNull();
        expect(decoded!.insets).toEqual(withInsets.insets);

        expect(simulateBattleHp(decoded!)).toEqual(simulateBattleHp(withInsets));
    });

    it('инсеты меняют рельеф: те же ходы дают другой бой хотя бы на одном seed', () => {
        // Рельеф поднят в свободную зону — при непустых инсетах он другой, значит
        // исход тех же выстрелов не обязан совпасть с боем во весь канвас. Иначе
        // инсеты не влияли бы на воспроизведение (и фидельность реплея была бы мнимой).
        // Сканируем набор seed: достаточно одного расхождения, чтобы доказать влияние.
        const moves: TReplay['moves'] = [fire(-0.895, 8), fire(-0.6, 12)];
        const insets = { top: 160, bottom: 180 };
        const differs = [1, 2, 3, 4, 5, 6, 7, 8].some((seed) => {
            const full = simulateBattleHp({ seed, width: 390, height: 844, moves });
            const zoned = simulateBattleHp({ seed, width: 390, height: 844, insets, moves });
            return JSON.stringify(full) !== JSON.stringify(zoned);
        });

        expect(differs).toBe(true);
    });

    it('разные seed при тех же ходах, как правило, дают разный бой (HP зависит от seed)', () => {
        // Записи с одинаковыми ходами, но разными seed: рельеф/ветер отличаются,
        // поэтому исход выстрела не обязан совпасть — иначе seed ни на что не влиял бы.
        const outcomes = [1, 2, 3, 4, 5].map((seed) =>
            JSON.stringify(simulateBattleHp(battle(seed, [fire(-0.895, 8), fire(-0.6, 12)]))),
        );

        expect(new Set(outcomes).size).toBeGreaterThan(1);
    });

    it('угол float64 не квантуется: соседние углы сериализуются раздельно', () => {
        const a: TReplay = battle(42, [fire(-0.8950000000000001, 8)]);
        const b: TReplay = battle(42, [fire(-0.895, 8)]);

        // Оба угла проходят encode → decode бит-в-бит (см. replay-codec), значит их
        // прогоны воспроизводятся точно каждый по себе.
        expect(simulateBattleHp(decodeReplay(encodeReplay(a))!)).toEqual(simulateBattleHp(a));
        expect(simulateBattleHp(decodeReplay(encodeReplay(b))!)).toEqual(simulateBattleHp(b));
    });
});
