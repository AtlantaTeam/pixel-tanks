import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { floor } from '@/shared/lib/canvas';
import { EWeaponKind, type TWeapon } from '@/shared/model';
import { MAX_HP } from '@/shared/config';
import { Ground } from './ground';
import { Tank } from './tank';
import { Bullet } from './bullet';
import { generateWind, MAX_WIND } from './wind';
import { computeWorldScale } from './world-scale';
import { pickPrecipPreset, type TPrecipPresetId } from './precipitation';
import {
    applyWindModifier,
    STORM_WIND_SHIFT_AFTER_SHOTS,
    stormShiftedWind,
    weatherModifierFor,
} from './weather-modifiers';

/**
 * Детерминизм боя С ПОГОДОЙ (#547, критерий «один сид — один пресет и одинаковый ход
 * боя, реплей воспроизводится побитово»). Существующий `replay-determinism.test.ts`
 * гоняет бой БЕЗ погоды; здесь — тот же headless-прогон на реальных блоках движка
 * (`Ground`+`generateWind`+`Bullet`, как `GamePlay.initPaint`/`moveBullet`), но с
 * применёнными следствиями погоды:
 *
 *  - ветер боя домножен на множитель пресета (снег +1/3) — `applyWindModifier`;
 *  - буря один раз меняет ветер после `STORM_WIND_SHIFT_AFTER_SHOTS` выстрелов —
 *    `stormShiftedWind`, ровно как в `GamePlay.maybeShiftStormWind`.
 *
 * Свойство: (сид + ходы) → итоговый HP остаётся чистой функцией и с погодой,
 * поэтому реплей того же сида воспроизводит бой один в один.
 */

const WIDTH = 800;
const HEIGHT = 600;
const WEAPON: TWeapon = { id: 0, name: 'Фугас', kind: EWeaponKind.HighExplosive };
const MAX_BULLET_STEPS = 20000;

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

const ctxStub = {
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    isPointInPath: (path: Path2DStub, x: number, y: number) => path.contains(x, y),
} as unknown as CanvasRenderingContext2D;

const refreshHitArea = (tank: Tank) => {
    const path = new Path2DStub();
    const body = tank.bodyRect();
    path.rect(body.x, body.y, body.width, body.height);
    tank.tankHitArea = path as unknown as Path2D;
};

const clampHp = (hp: number) => Math.min(MAX_HP, Math.max(0, hp));

type THp = { playerHp: number; enemyHp: number };
type TShot = { angle: number; power: number };

/**
 * Headless-прогон боя с погодой: ветер боя выведен из сида и домножен на множитель
 * пресета; после `STORM_WIND_SHIFT_AFTER_SHOTS` выстрелов буря меняет ветер на
 * выведенный из сида `stormShiftedWind` — ровно так же, как движок в живом бою.
 */
const simulateWeatherBattleHp = (
    seed: number | string,
    shots: TShot[],
    /** `skipStormShift` — тот же бой БЕЗ смены ветра бурей: контрольная сторона для
     *  проверки, что смена вообще влияет на исход, а не только на подпись в HUD. */
    options?: { skipStormShift?: boolean },
): THp => {
    const preset = pickPrecipPreset(seed);
    const modifier = weatherModifierFor(preset.id);

    const random = createSeededRandom(seed);
    const ground = new Ground(WIDTH, HEIGHT, random, undefined);
    // Порядок расхода RNG совпадает с GamePlay.initPaint: сначала рельеф, потом ветер.
    let wind = applyWindModifier(generateWind(random), modifier);
    const shiftWind =
        modifier.windShiftsMidBattle && !options?.skipStormShift
            ? stormShiftedWind(seed, wind)
            : undefined;

    const scale = computeWorldScale(WIDTH);
    const leftX = floor(WIDTH / 4);
    const rightX = floor((WIDTH * 3) / 4);
    const player = new Tank(
        leftX,
        HEIGHT - ground.heights[leftX],
        WIDTH,
        HEIGHT,
        0,
        [WEAPON],
        undefined,
        undefined,
        scale,
    );
    player.isActive = true;
    const enemy = new Tank(
        rightX,
        HEIGHT - ground.heights[rightX],
        WIDTH,
        HEIGHT,
        Math.PI,
        [WEAPON],
        undefined,
        undefined,
        scale,
    );

    const hp: THp = { playerHp: MAX_HP, enemyHp: MAX_HP };
    let completedShots = 0;

    for (const shot of shots) {
        player.gunpointAngle = shot.angle;
        player.power = shot.power;
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
            if (bullet.hittedTank === player) {
                hp.playerHp = clampHp(hp.playerHp - bullet.power);
            } else {
                hp.enemyHp = clampHp(hp.enemyHp - bullet.power);
            }
        }

        // Смена ветра бурей — после того же числа выстрелов, что в движке (#547).
        completedShots += 1;
        if (shiftWind !== undefined && completedShots === STORM_WIND_SHIFT_AFTER_SHOTS) {
            wind = shiftWind;
        }
    }

    return hp;
};

/** Первый сид из диапазона, дающий нужный пресет — чтобы бой реально шёл под погодой. */
const seedFor = (id: TPrecipPresetId): number => {
    for (let seed = 1; seed < 5000; seed++) {
        if (pickPrecipPreset(seed).id === id) return seed;
    }
    throw new Error(`Не найден сид для пресета ${id}`);
};

const SHOTS: TShot[] = [
    { angle: -0.895, power: 8 },
    { angle: -0.6, power: 12 },
    { angle: -0.7, power: 10 },
    { angle: -0.5, power: 14 },
];

describe('детерминизм боя с погодой (#547)', () => {
    // ВАЖНО про форму этих проверок. Прежде здесь стояло
    // `expect(sim(seed, SHOTS)).toEqual(sim(seed, SHOTS))` — двойной вызов ЧИСТОЙ функции
    // в одном процессе, то есть тавтология: тест был зелёным при любой реализации, включая
    // сломанную. Детерминизм доказывается не повтором, а тем, что результат НЕ зависит от
    // постороннего состояния и ОТЛИЧАЕТСЯ там, где погода обязана влиять.

    it('снег: HP боя не зависит от порядка прогонов и мусора в общем RNG', () => {
        const seed = seedFor('snow');
        const first = simulateWeatherBattleHp(seed, SHOTS);
        // Между прогонами жжём глобальный RNG-поток и гоняем ЧУЖОЙ сид: если бы симуляция
        // где-то опиралась на общий поток или на остаточное состояние, второй прогон разошёлся.
        const noise = createSeededRandom('noise');
        for (let i = 0; i < 50; i++) noise();
        simulateWeatherBattleHp(seedFor('rain'), SHOTS);
        expect(simulateWeatherBattleHp(seed, SHOTS)).toEqual(first);
    });

    it('буря: смена ветра в середине боя меняет ИСХОД, а не только показания HUD', () => {
        const seed = seedFor('sandstorm');
        const withShift = simulateWeatherBattleHp(seed, SHOTS);
        // Тот же бой без единственного отличия — смены ветра бурей. Если HP совпадёт,
        // значит смена ни на что не влияет, и «буря как модификатор» (#547) — декор.
        const withoutShift = simulateWeatherBattleHp(seed, SHOTS, { skipStormShift: true });
        expect(withShift).not.toEqual(withoutShift);
    });

    it('снег усиливает ветер — тот же выстрел летит по другой траектории (не декор)', () => {
        // Если бы множитель ветра ни на что не влиял, снег был бы чистым декором.
        // Прямой замер: X снаряда после фиксированного числа шагов полёта под тем же
        // углом/силой отличается с множителем и без него — снос ветром реально другой.
        const xAfterFlight = (wind: number): number => {
            const random = createSeededRandom(1);
            const ground = new Ground(WIDTH, HEIGHT, random, undefined);
            generateWind(random); // тот же расход RNG, что при живом бою
            const scale = computeWorldScale(WIDTH);
            const player = new Tank(
                floor(WIDTH / 4),
                HEIGHT - ground.heights[floor(WIDTH / 4)],
                WIDTH,
                HEIGHT,
                0,
                [WEAPON],
                undefined,
                undefined,
                scale,
            );
            const enemy = new Tank(
                floor((WIDTH * 3) / 4),
                HEIGHT - ground.heights[floor((WIDTH * 3) / 4)],
                WIDTH,
                HEIGHT,
                Math.PI,
                [WEAPON],
                undefined,
                undefined,
                scale,
            );
            player.isActive = true;
            // Высокий навесной выстрел: долгий полёт даёт ветру набрать снос вопреки
            // целочисленной (floor) физике — на коротком полёте поправка в 1/3 тонет
            // в округлении, на длинном проявляется.
            player.gunpointAngle = -1.4;
            player.power = 20;
            const bullet = new Bullet(WIDTH, HEIGHT, ground, player, enemy, wind);
            for (let i = 0; i < 300; i++) bullet.move();
            return bullet.x;
        };

        const base = MAX_WIND;
        expect(xAfterFlight(applyWindModifier(base, weatherModifierFor('snow')))).not.toBe(
            xAfterFlight(base),
        );
    });
});
