import { beforeAll, describe, expect, it, vi } from 'vitest';
import { floor } from '@/shared/lib/canvas';
import { createSeededRandom } from '@/shared/lib/random';
import { EWeaponKind, type TCoords, type TWeapon } from '@/shared/model';
import {
    advanceProjectile,
    BULLET_GRAVITY,
    fillTrajectoryPreview,
    TRAJECTORY_PREVIEW_POINTS,
    TRAJECTORY_PREVIEW_STRIDE,
    type TProjectileStep,
    type TTrajectoryPreviewInput,
} from './bullet-physics';
import { Bullet } from './bullet';
import { Ground } from './ground';
import { Tank } from './tank';

const WIDTH = 800;
const HEIGHT = 600;
const WEAPONS: TWeapon[] = [{ id: 0, name: 'Фугас', kind: EWeaponKind.HighExplosive }];

const ctxStub = {
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    isPointInPath: () => false,
} as unknown as CanvasRenderingContext2D;

beforeAll(() => {
    if (typeof globalThis.Path2D === 'undefined') {
        vi.stubGlobal(
            'Path2D',
            class {
                addPath = () => undefined;
                rect = () => undefined;
            },
        );
    }
});

describe('advanceProjectile', () => {
    it('прибавляет гравитацию к dy, только когда applyGravity=true', () => {
        const withG: TProjectileStep = { x: 0, y: 0, dx: 0, dy: 0 };
        const withoutG: TProjectileStep = { x: 0, y: 0, dx: 0, dy: 0 };
        advanceProjectile(withG, 0, true, BULLET_GRAVITY);
        advanceProjectile(withoutG, 0, false, BULLET_GRAVITY);
        expect(withG.dy).toBeCloseTo(BULLET_GRAVITY);
        expect(withoutG.dy).toBe(0);
    });

    it('ветер — постоянное боковое ускорение: dx растёт на wind за шаг', () => {
        const v: TProjectileStep = { x: 0, y: 0, dx: 5, dy: 0 };
        advanceProjectile(v, 0.01, true, BULLET_GRAVITY);
        expect(v.dx).toBeCloseTo(5.01);
    });

    it('позиция округляется floor — как в прежнем теле Bullet.move', () => {
        const v: TProjectileStep = { x: 0, y: 0, dx: 1.9, dy: 0 };
        advanceProjectile(v, 0, false, BULLET_GRAVITY);
        expect(v.x).toBe(1);
    });

    it('мутирует переданный вектор на месте (без аллокации)', () => {
        const v: TProjectileStep = { x: 10, y: 10, dx: 2, dy: 2 };
        advanceProjectile(v, 0, true, BULLET_GRAVITY);
        // Тот же объект, не копия.
        expect(v).toEqual({ x: 12, y: 12, dx: 2, dy: 2.1 });
    });
});

describe('fillTrajectoryPreview', () => {
    /** Преаллоцированный буфер узлов — как в движке (аллокаций в кадре нет). */
    const makeBuffer = (n: number): TCoords[] => Array.from({ length: n }, () => ({ x: 0, y: 0 }));

    const BASE_INPUT: TTrajectoryPreviewInput = {
        x: 100,
        y: 400,
        angle: -Math.PI / 4,
        power: 15,
        wind: 0,
        gravity: BULLET_GRAVITY,
        innerHeight: 600,
        radius: 2,
    };

    it('заполняет ровно TRAJECTORY_PREVIEW_POINTS узлов при просторном поле и буфере', () => {
        const out = makeBuffer(TRAJECTORY_PREVIEW_POINTS);
        const count = fillTrajectoryPreview({ ...BASE_INPUT, innerHeight: 100000 }, out);
        expect(count).toBe(TRAJECTORY_PREVIEW_POINTS);
    });

    it('детерминирован: одинаковый вход (фикс. ветер) → одинаковые узлы', () => {
        const input = { ...BASE_INPUT, wind: 0.02 };
        const a = makeBuffer(TRAJECTORY_PREVIEW_POINTS);
        const b = makeBuffer(TRAJECTORY_PREVIEW_POINTS);
        const countA = fillTrajectoryPreview(input, a);
        const countB = fillTrajectoryPreview(input, b);
        expect(countA).toBe(countB);
        expect(a).toEqual(b);
    });

    it('узлы дуги совпадают с шагами advanceProjectile — та же формула, что и полёт', () => {
        const input = { ...BASE_INPUT, wind: 0.02 };
        const out = makeBuffer(TRAJECTORY_PREVIEW_POINTS);
        const count = fillTrajectoryPreview(input, out);

        // Независимо шагаем зеркало тем же общим шагом, тем же stride. Начальная
        // скорость — через тот же `floor` (`| 0`, усечение к нулю), что и Bullet:
        // для отрицательного dy это НЕ Math.floor, и подмена сместила бы дугу.
        const mirror: TProjectileStep = {
            x: input.x,
            y: input.y,
            dx: floor(Math.cos(input.angle) * input.power),
            dy: floor(Math.sin(input.angle) * input.power),
        };
        for (let p = 0; p < count; p++) {
            for (let s = 0; s < TRAJECTORY_PREVIEW_STRIDE; s++) {
                advanceProjectile(
                    mirror,
                    input.wind,
                    mirror.y + input.radius < input.innerHeight,
                    BULLET_GRAVITY,
                );
            }
            expect([out[p].x, out[p].y]).toEqual([mirror.x, mirror.y]);
        }
    });

    it('ветер сносит дугу вбок: положительный ветер даёт больший x на конце', () => {
        const noWind = makeBuffer(TRAJECTORY_PREVIEW_POINTS);
        const windy = makeBuffer(TRAJECTORY_PREVIEW_POINTS);
        const nc = fillTrajectoryPreview({ ...BASE_INPUT, innerHeight: 100000, wind: 0 }, noWind);
        const wc = fillTrajectoryPreview({ ...BASE_INPUT, innerHeight: 100000, wind: 0.05 }, windy);
        expect(windy[wc - 1].x).toBeGreaterThan(noWind[nc - 1].x);
    });

    it('гравитация тянет дугу вниз относительно прямого выстрела', () => {
        // В первые ~35% пути снаряд ещё поднимается (dy остаётся отрицательным),
        // поэтому «y растёт к концу» неверно. Гравитацию проверяем сравнением с
        // прямой линией без неё: с гравитацией последний узел НИЖЕ (больше y).
        const input = { ...BASE_INPUT, innerHeight: 100000 };
        const gravityOut = makeBuffer(TRAJECTORY_PREVIEW_POINTS);
        const count = fillTrajectoryPreview(input, gravityOut);

        // Прямая: тот же старт и та же начальная скорость, но гравитация выключена.
        const straight: TProjectileStep = {
            x: input.x,
            y: input.y,
            dx: floor(Math.cos(input.angle) * input.power),
            dy: floor(Math.sin(input.angle) * input.power),
        };
        for (let p = 0; p < count; p++) {
            for (let s = 0; s < TRAJECTORY_PREVIEW_STRIDE; s++) {
                advanceProjectile(straight, input.wind, false, BULLET_GRAVITY);
            }
        }
        expect(gravityOut[count - 1].y).toBeGreaterThan(straight.y);
    });

    it('использует gravity из input, а не зашитый дефолт', () => {
        // Гравитацию пробрасывает вызывающий (issue #475): удвоенная тянет дугу ниже,
        // чем дефолтная. Если бы input.gravity игнорировался (брался дефолт), обе дуги
        // совпали бы — тест бы упал.
        const input = { ...BASE_INPUT, innerHeight: 100000 };
        const strong = makeBuffer(TRAJECTORY_PREVIEW_POINTS);
        const weak = makeBuffer(TRAJECTORY_PREVIEW_POINTS);
        const sc = fillTrajectoryPreview({ ...input, gravity: BULLET_GRAVITY * 2 }, strong);
        const wc = fillTrajectoryPreview({ ...input, gravity: BULLET_GRAVITY }, weak);
        expect(strong[sc - 1].y).toBeGreaterThan(weak[wc - 1].y);
    });

    it('не пишет за пределы буфера короче points — возвращает длину буфера', () => {
        const out = makeBuffer(4);
        const count = fillTrajectoryPreview({ ...BASE_INPUT, innerHeight: 100000 }, out);
        expect(count).toBe(4);
    });

    it('обрывает дугу, когда снаряд ушёл ниже пола', () => {
        // Тесное поле: снаряд быстро уходит за нижнюю кромку, узлов меньше максимума.
        const out = makeBuffer(TRAJECTORY_PREVIEW_POINTS);
        const count = fillTrajectoryPreview(
            { ...BASE_INPUT, y: 590, angle: Math.PI / 4, innerHeight: 600 },
            out,
        );
        expect(count).toBeLessThan(TRAJECTORY_PREVIEW_POINTS);
        expect(count).toBeGreaterThan(0);
    });
});

describe('Bullet.move использует общий шаг advanceProjectile (одно место правды)', () => {
    it('реальный полёт снаряда бит-в-бит совпадает с advanceProjectile', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(42));
        const active = new Tank(100, HEIGHT - 100, WIDTH, HEIGHT, -Math.PI / 4, WEAPONS);
        active.power = 15;
        const target = new Tank(600, HEIGHT - 100, WIDTH, HEIGHT, Math.PI, WEAPONS);
        const wind = 0.01;
        const bullet = new Bullet(WIDTH, HEIGHT, ground, active, target, wind);

        // Независимая копия старта снаряда — шагаем её тем же общим шагом.
        const mirror: TProjectileStep = {
            x: bullet.x,
            y: bullet.y,
            dx: bullet.dx,
            dy: bullet.dy,
        };

        for (let i = 0; i < 100; i++) {
            bullet.move();
            advanceProjectile(mirror, wind, mirror.y + bullet.radius < HEIGHT, BULLET_GRAVITY);
            expect([bullet.x, bullet.y]).toEqual([mirror.x, mirror.y]);
        }
        // ctxStub нужен только для сигнатуры isHit — здесь не вызываем, но держим
        // импорт-путь идентичным bullet.test.ts (Path2D-стаб).
        void ctxStub;
    });
});
