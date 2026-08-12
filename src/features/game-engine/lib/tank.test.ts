import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import type { TWeapon } from '@/shared/model';
import { Ground } from './ground';
import { Tank } from './tank';
import { WORLD_UNITS } from './world-scale';

const WIDTH = 800;
const HEIGHT = 600;
const WEAPON: TWeapon = { id: 0, name: 'Снаряд' };

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
