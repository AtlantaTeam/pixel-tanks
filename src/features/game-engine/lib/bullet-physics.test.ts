import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import type { TWeapon } from '@/shared/model';
import { advanceProjectile, BULLET_GRAVITY, type TProjectileStep } from './bullet-physics';
import { Bullet } from './bullet';
import { Ground } from './ground';
import { Tank } from './tank';

const WIDTH = 800;
const HEIGHT = 600;
const WEAPONS: TWeapon[] = [{ id: 0, name: 'Снаряд #0' }];

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
