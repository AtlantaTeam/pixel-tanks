import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { floor } from '@/shared/lib/canvas';
import type { TWeapon } from '@/shared/model';
import { Bullet } from './bullet';
import { Ground } from './ground';
import { Tank } from './tank';

const WIDTH = 800;
const HEIGHT = 600;
const WEAPONS: TWeapon[] = [{ id: 0, name: 'Снаряд #0' }];

// Физика не должна требовать реального Canvas: ctx нужен только Path2D-проверке попадания в танк
const ctxStub = {
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    isPointInPath: () => false,
} as unknown as CanvasRenderingContext2D;

const makeTank = (x: number, angle: number, power: number) => {
    const tank = new Tank(x, HEIGHT - 100, WIDTH, HEIGHT, angle, WEAPONS);
    tank.power = power;
    return tank;
};

const makeBullet = (angle: number, power: number, wind: number, seed = 42) => {
    const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(seed));
    const active = makeTank(100, angle, power);
    const target = makeTank(600, Math.PI, power);
    return { bullet: new Bullet(WIDTH, HEIGHT, ground, active, target, wind), ground };
};

const recordTrajectory = (bullet: Bullet, steps: number) => {
    const points: Array<[number, number]> = [];
    for (let i = 0; i < steps; i++) {
        bullet.move();
        points.push([bullet.x, bullet.y]);
    }
    return points;
};

beforeAll(() => {
    if (typeof globalThis.Path2D === 'undefined') {
        vi.stubGlobal(
            'Path2D',
            class {
                addPath = () => undefined;
            },
        );
    }
});

describe('Bullet: детерминизм траектории', () => {
    it('даёт идентичную траекторию при одинаковом входе (угол, сила, ветер)', () => {
        const first = makeBullet(-Math.PI / 4, 15, 0.002);
        const second = makeBullet(-Math.PI / 4, 15, 0.002);

        const firstPath = recordTrajectory(first.bullet, 120);
        const secondPath = recordTrajectory(second.bullet, 120);

        expect(firstPath).toEqual(secondPath);
    });

    it('даёт разные траектории при разном ветре', () => {
        const calm = makeBullet(-Math.PI / 4, 15, 0);
        const windy = makeBullet(-Math.PI / 4, 15, 0.01);

        const calmPath = recordTrajectory(calm.bullet, 120);
        const windyPath = recordTrajectory(windy.bullet, 120);

        expect(calmPath).not.toEqual(windyPath);
    });

    it('гравитация ускоряет вертикальное падение с каждым шагом', () => {
        const { bullet } = makeBullet(0, 10, 0);

        const path = recordTrajectory(bullet, 60);
        const verticalSteps = path.slice(1).map(([, y], i) => y - path[i][1]);

        for (let i = 1; i < verticalSteps.length; i++) {
            expect(verticalSteps[i]).toBeGreaterThanOrEqual(verticalSteps[i - 1]);
        }
    });

    it('без ветра горизонтальная скорость постоянна', () => {
        const { bullet } = makeBullet(0, 10, 0);
        const dxBefore = bullet.dx;

        recordTrajectory(bullet, 60);

        expect(bullet.dx).toBe(dxBefore);
    });

    it('ветер — постоянное боковое ускорение: dx растёт линейно на wind за шаг', () => {
        const wind = 0.01;
        const { bullet } = makeBullet(0, 10, wind);
        const dxBefore = bullet.dx;

        recordTrajectory(bullet, 60);

        expect(bullet.dx).toBeCloseTo(dxBefore + 60 * wind, 10);
    });

    it('отрицательный ветер сносит влево, положительный — вправо (симметрично)', () => {
        const calm = makeBullet(-Math.PI / 4, 15, 0);
        const left = makeBullet(-Math.PI / 4, 15, -0.01);
        const right = makeBullet(-Math.PI / 4, 15, 0.01);

        const calmX = recordTrajectory(calm.bullet, 120).at(-1)![0];
        const leftX = recordTrajectory(left.bullet, 120).at(-1)![0];
        const rightX = recordTrajectory(right.bullet, 120).at(-1)![0];

        expect(leftX).toBeLessThan(calmX);
        expect(rightX).toBeGreaterThan(calmX);
    });

    it('вертикальный выстрел (dx=0) сносится ветром', () => {
        const { bullet } = makeBullet(-Math.PI / 2, 15, 0.01);
        const startX = bullet.x;
        expect(bullet.dx).toBe(0);

        recordTrajectory(bullet, 300);

        expect(bullet.x).toBeGreaterThan(startX);
    });
});

describe('Bullet: столкновения', () => {
    it('отскакивает от правой стены со сменой направления', () => {
        const { bullet } = makeBullet(0, 20, 0);
        expect(bullet.dx).toBeGreaterThan(0);

        let bounced = false;
        for (let i = 0; i < 200 && !bounced; i++) {
            bullet.move();
            bullet.isHit(ctxStub);
            bounced = bullet.dx < 0;
        }

        expect(bounced).toBe(true);
        expect(bullet.x + bullet.radius).toBeLessThanOrEqual(WIDTH);
    });

    it('приземляется в грунт за конечное число шагов на уровне рельефа', () => {
        const { bullet, ground } = makeBullet(-Math.PI / 3, 12, 0);

        let steps = 0;
        while (!bullet.isHit(ctxStub) && steps < 5000) {
            bullet.move();
            steps++;
        }

        expect(steps).toBeLessThan(5000);
        expect(bullet.isTankHit).toBe(false);
        const groundHeightAtImpact = ground.heights[floor(bullet.x)];
        expect(HEIGHT - bullet.y - bullet.radius).toBeLessThanOrEqual(groundHeightAtImpact);
    });
});
