import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { TTankWheelSpec as TSkinWheelSpec } from '@/entities/tank-skins';
import { createSeededRandom } from '@/shared/lib/random';
import { EWeaponKind, type TWeapon } from '@/shared/model';
import { Ground } from './ground';
import { drawTankWheels, Tank, wheelRotationDelta, type TTankWheelSpec } from './tank';
import { WORLD_UNITS } from './world-scale';

// Пин структурного совпадения `TTankWheelSpec` движка (`tank.ts`) и реестра
// скинов (`entities/tank-skins`). `Tank` намеренно НЕ импортирует тип из
// entities (развязка «движок не знает про скины», docblock в `tank.ts`), но
// формы обязаны совпадать — `GamePlay` кормит движок `geometry.wheels`. Разъедутся
// (кто-то добавит поле в одну из копий) — тип-ассерт не скомпилируется в
// `npm run typecheck`, а не всплывёт молчаливым структурным дрейфом.
type MutuallyAssignable<A, B> = A extends B ? (B extends A ? true : never) : never;
const _wheelSpecMatch: MutuallyAssignable<TTankWheelSpec, TSkinWheelSpec> = true;
void _wheelSpecMatch;

const WIDTH = 800;
const HEIGHT = 600;
const WEAPON: TWeapon = { id: 0, name: 'Фугас', kind: EWeaponKind.HighExplosive };

// happy-dom не предоставляет Path2D. Заглушка хранит прямоугольник хит-зоны и его
// возвращает — ровно то, что читает Bullet.checkTankHit и проверяет этот тест.
class Path2DStub {
    rectArgs: [number, number, number, number] | null = null;
    rect(x: number, y: number, w: number, h: number) {
        this.rectArgs = [x, y, w, h];
    }
    addPath() {}
}

beforeAll(() => {
    if (typeof globalThis.Path2D === 'undefined') {
        vi.stubGlobal('Path2D', Path2DStub);
    }
    if (typeof globalThis.DOMMatrix === 'undefined') {
        // rotateFigure строит DOMMatrix для наклона корпуса; в этом тесте наклон не
        // важен (сверяем только прямоугольник тела), поэтому достаточно заглушки с
        // цепочкой self-методов, возвращающих себя.
        class DOMMatrixStub {
            a = 1;
            b = 0;
            c = 0;
            d = 1;
            e = 0;
            f = 0;
            translateSelf() {
                return this;
            }
            rotateSelf() {
                return this;
            }
        }
        vi.stubGlobal('DOMMatrix', DOMMatrixStub);
    }
});

/** ctx-заглушка, записывающая аргументы drawImage корпуса (первый вызов). */
const makeRecordingCtx = () => {
    const drawImageCalls: number[][] = [];
    const ctx = {
        save: () => undefined,
        restore: () => undefined,
        translate: () => undefined,
        rotate: () => undefined,
        setTransform: () => undefined,
        drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
            drawImageCalls.push([x, y, w, h]);
        },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, drawImageCalls };
};

/** Плоский рельеф, чтобы наклон корпуса не влиял на позицию тела. */
const flatGround = () => {
    const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(1));
    ground.heights = new Array<number>(WIDTH).fill(100);
    return ground;
};

// Изображение корпуса, чтобы сработала ветка ctx.drawImage в Tank.draw.
const bodyImg = {} as HTMLImageElement;

describe('Tank — масштаб мира (issue #455)', () => {
    it('без scale (дефолт) размеры равны канону прежних констант', () => {
        const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON]);
        expect(tank.scale).toBe(1);
        expect(tank.tankWidth).toBe(WORLD_UNITS.tankWidth);
        expect(tank.tankHeight).toBe(WORLD_UNITS.tankHeight);
    });

    it.each([0.5, 0.768, 1.28, 1.5])('scale=%p масштабирует корпус и ствол', (scale) => {
        const tank = new Tank(
            200,
            HEIGHT - 100,
            WIDTH,
            HEIGHT,
            0,
            [WEAPON],
            undefined,
            undefined,
            scale,
        );
        expect(tank.tankWidth).toBeCloseTo(WORLD_UNITS.tankWidth * scale, 6);
        expect(tank.tankHeight).toBeCloseTo(WORLD_UNITS.tankHeight * scale, 6);
    });

    it('bodyRect масштабируется коэффициентом: тело поднято на tankHeight', () => {
        const scale = 0.5;
        const y = HEIGHT - 100;
        const tank = new Tank(200, y, WIDTH, HEIGHT, 0, [WEAPON], undefined, undefined, scale);
        const rect = tank.bodyRect();
        expect(rect.width).toBeCloseTo(WORLD_UNITS.tankWidth * scale, 6);
        expect(rect.height).toBeCloseTo(WORLD_UNITS.tankHeight * scale, 6);
        // Верх тела — на tankHeight выше базовой линии (низ тела на y).
        expect(rect.y).toBe(Math.floor(y - tank.tankHeight));
    });

    it('setScale пересчитывает размеры и якорь ствола', () => {
        const tank = new Tank(
            200,
            HEIGHT - 100,
            WIDTH,
            HEIGHT,
            0,
            [WEAPON],
            undefined,
            undefined,
            1,
        );
        tank.setScale(0.5);
        expect(tank.scale).toBe(0.5);
        expect(tank.tankWidth).toBeCloseTo(WORLD_UNITS.tankWidth * 0.5, 6);
        // Якорь ствола = x + масштабированная дельта.
        expect(tank.gunpointX).toBeCloseTo(tank.x + WORLD_UNITS.gunpointDeltaX * 0.5, 6);
    });

    it('хит-зона совпадает с отрисовкой корпуса при не единичном масштабе (критерий #455)', () => {
        const scale = 0.5;
        const tank = new Tank(
            200,
            HEIGHT - 100,
            WIDTH,
            HEIGHT,
            0,
            [WEAPON],
            bodyImg,
            undefined,
            scale,
        );
        const { ctx, drawImageCalls } = makeRecordingCtx();

        tank.draw(ctx, null, flatGround());

        // Первый drawImage — корпус танка. Его прямоугольник обязан совпасть с
        // прямоугольником, записанным в хит-зону (tankHitArea), иначе попадание
        // засчитывалось бы не там, где видно касание.
        const hitArea = tank.tankHitArea as unknown as Path2DStub;
        expect(drawImageCalls.length).toBeGreaterThan(0);
        expect(hitArea.rectArgs).not.toBeNull();
        expect(hitArea.rectArgs).toEqual(drawImageCalls[0]);
    });
});

describe('wheelRotationDelta — угол поворота катка от пройденного пути (issue #496)', () => {
    it('качение без проскальзывания: угол = путь / радиус', () => {
        expect(wheelRotationDelta(20, 10)).toBe(2);
    });

    it('обратное направление даёт отрицательный угол', () => {
        expect(wheelRotationDelta(-20, 10)).toBe(-2);
    });

    it('нулевой/отрицательный радиус не делит на ноль — угол 0', () => {
        expect(wheelRotationDelta(20, 0)).toBe(0);
        expect(wheelRotationDelta(20, -5)).toBe(0);
    });
});

describe('drawTankWheels — раскладка катков (issue #496)', () => {
    // ctx-заглушка, записывающая translate (центр катка) и drawImage (радиус).
    const makeWheelCtx = () => {
        const translates: number[][] = [];
        const draws: number[][] = [];
        const ctx = {
            save: () => undefined,
            restore: () => undefined,
            translate: (x: number, y: number) => translates.push([x, y]),
            rotate: () => undefined,
            drawImage: (_img: unknown, x: number, y: number, w: number, h: number) =>
                draws.push([x, y, w, h]),
        } as unknown as CanvasRenderingContext2D;
        return { ctx, translates, draws };
    };

    const wheelImg = {} as HTMLImageElement;
    const body = { x: 100, y: 40, width: 60, height: 30 };
    const wheels: TTankWheelSpec[] = [
        { cx: 0.25, cy: 0.9, r: 0.1 },
        { cx: 0.5, cy: 0.9, r: 0.1 },
        { cx: 0.75, cy: 0.9, r: 0.1 },
    ];

    it('рисует ровно по одному катку на каждую позицию геометрии', () => {
        const { ctx, draws } = makeWheelCtx();
        drawTankWheels(ctx, wheelImg, wheels, body, 0);
        expect(draws).toHaveLength(wheels.length);
    });

    it('центр = body + доля (translate), радиус = r*width, спрайт от -r до +r', () => {
        const { ctx, translates, draws } = makeWheelCtx();
        drawTankWheels(ctx, wheelImg, wheels, body, 0);
        wheels.forEach((wheel, i) => {
            const cx = body.x + wheel.cx * body.width;
            const cy = body.y + wheel.cy * body.height;
            const r = wheel.r * body.width;
            expect(translates[i]).toEqual([cx, cy]);
            // drawImage рисуется от центра (после translate), поэтому [-r,-r,2r,2r].
            expect(draws[i]).toEqual([-r, -r, r * 2, r * 2]);
        });
    });

    it('без картинки катка ничего не рисует (гард на неподгруженный спрайт)', () => {
        const { ctx, draws } = makeWheelCtx();
        drawTankWheels(ctx, undefined, wheels, body, 0);
        expect(draws).toHaveLength(0);
    });
});

describe('Tank — вращение катков (issue #496)', () => {
    // Один каток в центре тела, радиус — 1/6 ширины корпуса: при tankWidth=60
    // (scale=1) это 10px, удобное круглое число для проверки угла.
    const WHEELS: TTankWheelSpec[] = [{ cx: 0.5, cy: 0.9, r: 1 / 6 }];

    const makeMovingTank = (dx: number, wheelRotationEnabled = true) => {
        const tank = new Tank(
            200,
            HEIGHT - 100,
            WIDTH,
            HEIGHT,
            0,
            [WEAPON],
            undefined,
            undefined,
            1,
            undefined,
            WHEELS,
            wheelRotationEnabled,
        );
        tank.dx = dx;
        return tank;
    };

    it('на месте (dx=0) катки не крутятся', () => {
        // move() напрямую здесь не зовём: боевой код вызывает его только когда
        // `this.dx` истинно (см. `recalcPosition` — `if (this.dx && !this.dy)`),
        // поэтому проверяем реальный путь простоя, а не голый move() с dx=0.
        const tank = makeMovingTank(0);
        const ground = flatGround();
        const { ctx } = makeRecordingCtx();
        tank.recalcPosition(ctx, ground);
        tank.recalcPosition(ctx, ground);
        expect(tank.wheelRotation).toBe(0);
    });

    it('скорость вращения пропорциональна пройденному пути, не числу кадров', () => {
        const tank = makeMovingTank(50);
        for (let i = 0; i < 5; i++) tank.move();
        // Каждый вызов move() при dx=50 (шаг 2 < |dx|) продвигает танк на 2px —
        // за 5 вызовов пройдено 10px. Радиус катка — 10px (60 * 1/6) → угол 1 рад.
        expect(tank.wheelRotation).toBeCloseTo(1, 6);

        const tankDoubleFrames = makeMovingTank(50);
        for (let i = 0; i < 10; i++) tankDoubleFrames.move();
        // В два раза больше вызовов move() при том же шаге — путь и угол тоже
        // удваиваются: считает путь, а не количество кадров/вызовов.
        expect(tankDoubleFrames.wheelRotation).toBeCloseTo(2, 6);
    });

    it('направление вращения совпадает с направлением движения', () => {
        const right = makeMovingTank(50);
        const left = makeMovingTank(-50);
        for (let i = 0; i < 5; i++) {
            right.move();
            left.move();
        }
        expect(right.wheelRotation).toBeGreaterThan(0);
        expect(left.wheelRotation).toBeLessThan(0);
        expect(left.wheelRotation).toBeCloseTo(-right.wheelRotation, 6);
    });

    it('prefers-reduced-motion (wheelRotationEnabled=false) отключает вращение', () => {
        const tank = makeMovingTank(50, false);
        for (let i = 0; i < 5; i++) tank.move();
        expect(tank.wheelRotation).toBe(0);
    });
});

/**
 * ctx-заглушка, записывающая вызовы `ellipse` (центр тени) поверх методов
 * `makeRecordingCtx` — draw() после тени идёт обычным путём корпуса.
 */
const makeShadowCtx = () => {
    const ellipseCalls: number[][] = [];
    const base = makeRecordingCtx().ctx as unknown as Record<string, unknown>;
    const ctx = {
        ...base,
        beginPath: () => undefined,
        fill: () => undefined,
        ellipse: (
            x: number,
            y: number,
            rx: number,
            ry: number,
            rot: number,
            s: number,
            e: number,
        ) => {
            ellipseCalls.push([x, y, rx, ry, rot, s, e]);
        },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, ellipseCalls };
};

describe('Tank.draw — тень от светила (#545)', () => {
    const centerX = (tank: Tank) => tank.x + tank.tankWidth / 2;

    it('без shadow (дефолт) эллипс тени не рисуется', () => {
        const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON], bodyImg);
        const { ctx, ellipseCalls } = makeShadowCtx();
        tank.draw(ctx, null, flatGround());
        expect(ellipseCalls).toHaveLength(0);
    });

    it('светило справа (dx<0) → тень смещена влево от центра корпуса', () => {
        const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON], bodyImg);
        tank.shadow = { direction: { dx: -0.6, dy: 0.8 }, color: 'rgba(0,0,0,0.3)' };
        const { ctx, ellipseCalls } = makeShadowCtx();
        tank.draw(ctx, null, flatGround());
        expect(ellipseCalls).toHaveLength(1);
        // Центр эллипса левее середины корпуса — знак совпадает со знаком dx (влево).
        expect(ellipseCalls[0][0]).toBeLessThan(centerX(tank));
    });

    it('светило слева (dx>0) → тень смещена вправо от центра корпуса', () => {
        const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON], bodyImg);
        tank.shadow = { direction: { dx: 0.6, dy: 0.8 }, color: 'rgba(0,0,0,0.3)' };
        const { ctx, ellipseCalls } = makeShadowCtx();
        tank.draw(ctx, null, flatGround());
        expect(ellipseCalls).toHaveLength(1);
        expect(ellipseCalls[0][0]).toBeGreaterThan(centerX(tank));
    });

    it('тень лежит на поверхности рельефа под корпусом (пиксель контакта)', () => {
        const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON], bodyImg);
        tank.shadow = { direction: { dx: -0.6, dy: 0.8 }, color: 'rgba(0,0,0,0.3)' };
        const { ctx, ellipseCalls } = makeShadowCtx();
        // Плоский рельеф высотой 100 → поверхность на HEIGHT-100.
        tank.draw(ctx, null, flatGround());
        expect(ellipseCalls[0][1]).toBe(HEIGHT - 100);
    });
});
