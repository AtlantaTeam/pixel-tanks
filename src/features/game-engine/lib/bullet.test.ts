import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { floor } from '@/shared/lib/canvas';
import { EWeaponKind, type TWeapon } from '@/shared/model';
import { Bullet } from './bullet';
import { Ground } from './ground';
import { Tank } from './tank';
import { WORLD_UNITS } from './world-scale';
import { WEAPON_SPECS } from './weapon-specs';

const WIDTH = 800;
const HEIGHT = 600;
const WEAPONS: TWeapon[] = [{ id: 0, name: 'Фугас', kind: EWeaponKind.HighExplosive }];

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

    it('отскакивает от верхней стены: снаряд не покидает поле сверху и возвращается вниз', () => {
        // Выстрел строго вверх на максимальной силе — снаряд неминуемо достигает
        // верхней границы поля (#264: раньше уходил за верх, ни одна ветка не отбивала).
        // Проверяем наблюдаемое поведение (позиция y), не внутреннее поле dy: снаряд
        // на такой скорости проходит ~20px/кадр, поэтому разворот ловим не по мгновенному
        // знаку, а по факту «достал до верха → пошёл обратно вниз».
        const { bullet } = makeBullet(-Math.PI / 2, 20, 0);

        let reachedTop = false;
        let cameBackDown = false;
        let minY = Infinity;
        for (let i = 0; i < 300; i++) {
            bullet.move();
            bullet.isHit(ctxStub);
            minY = Math.min(minY, bullet.y);
            // Верхняя стена зажимает y ровно в radius — это касание верха.
            if (bullet.y <= bullet.radius) reachedTop = true;
            // После касания снаряд снова уходит вниз по полю — значит отскочил,
            // а не застрял у границы и не улетел за неё.
            if (reachedTop && bullet.y > bullet.radius) cameBackDown = true;
        }

        // Без фикса #264 снаряд уходил за верх (y < radius) — этот инвариант ловит регресс.
        expect(minY).toBeGreaterThanOrEqual(bullet.radius);
        expect(reachedTop).toBe(true);
        expect(cameBackDown).toBe(true);
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

describe('Bullet.setScale — перемасштабирование при ресайзе (масштаб мира, #455)', () => {
    // drawExplosion рисует радиальный градиент — ctxStub попаданий его не умеет,
    // поэтому здесь ctx с минимальным набором вызовов взрыва (без реального Canvas).
    const explosionCtx = {
        createRadialGradient: () => ({ addColorStop: () => undefined }),
        beginPath: () => undefined,
        arc: () => undefined,
        fill: () => undefined,
        closePath: () => undefined,
        fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    it('обновляет радиус снаряда и радиус взрыва новым коэффициентом', () => {
        // Снаряд создан на scale === 1 (танк без явного scale) — радиусы канонны.
        const { bullet } = makeBullet(-Math.PI / 4, 10, 0);
        expect(bullet.radius).toBe(WORLD_UNITS.bulletRadius);

        // Ресайз на широкую арену увеличил масштаб мира — снаряд и взрыв растут вместе
        // с телом танка, а не остаются прежнего размера (критерий #455).
        bullet.setScale(1.5);
        expect(bullet.radius).toBe(WORLD_UNITS.bulletRadius * 1.5);

        // Взрыв дорастает до нового максимума: на 1.5 он превышает канонный r=50.
        // explosionRadius растёт на 1 за кадр, поэтому число кадров до финала ≈ максимум.
        let frames = 0;
        while (!bullet.isFinished && frames < 500) {
            bullet.drawExplosion(explosionCtx);
            frames += 1;
        }
        expect(bullet.isFinished).toBe(true);
        expect(frames).toBeGreaterThan(WORLD_UNITS.explosionMaxRadius);
    });
});

describe('Bullet: типы оружия (issue #483)', () => {
    // Взрыв рисует радиальный градиент и обод ударной волны — минимальный ctx.
    const explosionCtx = {
        createRadialGradient: () => ({ addColorStop: () => undefined }),
        beginPath: () => undefined,
        arc: () => undefined,
        fill: () => undefined,
        stroke: () => undefined,
        closePath: () => undefined,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    const makeBulletWithSpec = (kind: EWeaponKind, seed = 7) => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(seed));
        const active = makeTank(100, -Math.PI / 4, 12);
        const target = makeTank(600, Math.PI, 12);
        const bullet = new Bullet(WIDTH, HEIGHT, ground, active, target, 0, WEAPON_SPECS[kind]);
        return { bullet, ground };
    };

    const runExplosion = (bullet: Bullet) => {
        let frames = 0;
        while (!bullet.isFinished && frames < 2000) {
            bullet.drawExplosion(explosionCtx);
            frames += 1;
        }
        return frames;
    };

    it('фугас: ровно один очаг, один кратер', () => {
        const { bullet, ground } = makeBulletWithSpec(EWeaponKind.HighExplosive);
        const fall = vi.spyOn(ground, 'fall');
        runExplosion(bullet);
        expect(fall).toHaveBeenCalledTimes(1);
    });

    it('кластер: три последовательных очага, три кратера в разных точках', () => {
        const { bullet, ground } = makeBulletWithSpec(EWeaponKind.Cluster);
        const fall = vi.spyOn(ground, 'fall');
        bullet.x = 300;
        bullet.y = 200;
        runExplosion(bullet);
        expect(fall).toHaveBeenCalledTimes(3);
        // Центральный очаг в точке попадания, боковые — по фиксированным смещениям.
        const xs = fall.mock.calls.map((c) => c[0]);
        expect(xs[0]).toBe(300);
        expect(xs[1]).toBeLessThan(300);
        expect(xs[2]).toBeGreaterThan(300);
        expect(bullet.isFinished).toBe(true);
    });

    it('кластер помечает смену очага для game-play (частицы+fullRedraw на очаг)', () => {
        const { bullet } = makeBulletWithSpec(EWeaponKind.Cluster);
        let advances = 0;
        let frames = 0;
        while (!bullet.isFinished && frames < 2000) {
            bullet.drawExplosion(explosionCtx);
            if (bullet.consumeFocusAdvanced()) advances += 1;
            frames += 1;
        }
        // Два перехода на три очага (после 1-го и 2-го).
        expect(advances).toBe(2);
    });

    it('роющий: кратер узкий и смещён вниз (глубокая воронка)', () => {
        const { bullet: digger, ground: g1 } = makeBulletWithSpec(EWeaponKind.Digger);
        const { bullet: he, ground: g2 } = makeBulletWithSpec(EWeaponKind.HighExplosive);
        digger.x = he.x = 300;
        digger.y = he.y = 200;
        const diggerFall = vi.spyOn(g1, 'fall');
        const heFall = vi.spyOn(g2, 'fall');
        runExplosion(digger);
        runExplosion(he);
        const [, diggerY, diggerR] = diggerFall.mock.calls[0];
        const [, heY, heR] = heFall.mock.calls[0];
        // Кратер роющего глубже (ниже точки попадания) и уже фугасного.
        expect(diggerY).toBeGreaterThan(heY);
        expect(diggerR).toBeLessThan(heR);
    });

    it('мощный заряд: взрыв крупнее фугаса (кратер шире)', () => {
        const { bullet: heavy, ground: g1 } = makeBulletWithSpec(EWeaponKind.Heavy);
        const { bullet: he, ground: g2 } = makeBulletWithSpec(EWeaponKind.HighExplosive);
        const heavyFall = vi.spyOn(g1, 'fall');
        const heFall = vi.spyOn(g2, 'fall');
        runExplosion(heavy);
        runExplosion(he);
        expect(heavyFall.mock.calls[0][2]).toBeGreaterThan(heFall.mock.calls[0][2]);
    });

    it('детерминизм: тот же тип и вход дают те же кратеры', () => {
        const { bullet: a, ground: ga } = makeBulletWithSpec(EWeaponKind.Cluster);
        const { bullet: b, ground: gb } = makeBulletWithSpec(EWeaponKind.Cluster);
        const fa = vi.spyOn(ga, 'fall');
        const fb = vi.spyOn(gb, 'fall');
        runExplosion(a);
        runExplosion(b);
        expect(fa.mock.calls).toEqual(fb.mock.calls);
    });

    it('снаряд без явной спеки — фугас (совместимость)', () => {
        const { bullet } = makeBullet(-Math.PI / 4, 10, 0);
        expect(bullet.spec.kind).toBe(EWeaponKind.HighExplosive);
    });

    // Критерий #483: ни один эффект не рисуется за пределами текущего explosionRadius
    // (никаких колец и ореолов впереди фронта). Записываем радиус каждой дуги —
    // заливки взрыва И обода ударной волны — и сверяем с радиусом фронта этого кадра.
    it.each([
        EWeaponKind.HighExplosive,
        EWeaponKind.Heavy,
        EWeaponKind.Cluster,
        EWeaponKind.Digger,
    ])('ничего не рисуется за фронтом взрыва (%s)', (kind) => {
        const radii: number[] = [];
        const recordingCtx = {
            createRadialGradient: () => ({ addColorStop: () => undefined }),
            beginPath: () => undefined,
            arc: (_x: number, _y: number, r: number) => radii.push(r),
            fill: () => undefined,
            stroke: () => undefined,
            closePath: () => undefined,
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 0,
        } as unknown as CanvasRenderingContext2D;

        const { bullet } = makeBulletWithSpec(kind);
        let frames = 0;
        while (!bullet.isFinished && frames < 2000) {
            radii.length = 0;
            const front = bullet.explosionRadius;
            bullet.drawExplosion(recordingCtx);
            for (const r of radii) expect(r).toBeLessThanOrEqual(front);
            frames += 1;
        }
    });
});
