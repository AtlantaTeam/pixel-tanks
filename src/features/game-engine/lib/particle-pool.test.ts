import { describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { ParticlePool, damageFlashBurst, groundBurst, type TBurstConfig } from './particle-pool';

const makeConfig = (over: Partial<TBurstConfig> = {}): TBurstConfig => ({
    x: 100,
    y: 100,
    count: 10,
    colors: ['#aaaaaa', '#bbbbbb'],
    speedMin: 1,
    speedMax: 5,
    angleMin: -Math.PI,
    angleMax: 0,
    lifeMin: 20,
    lifeMax: 40,
    sizeMin: 2,
    sizeMax: 4,
    gravity: 0.15,
    ...over,
});

describe('ParticlePool: пул без аллокаций', () => {
    it('предвыделяет ровно capacity частиц, изначально все неактивны', () => {
        const pool = new ParticlePool(32, createSeededRandom(1));

        expect(pool.capacity).toBe(32);
        expect(pool.particlesView).toHaveLength(32);
        expect(pool.aliveCount()).toBe(0);
        expect(pool.hasAlive()).toBe(false);
        expect(pool.particlesView.every((p) => !p.active)).toBe(true);
    });

    it('emitBurst активирует ровно count частиц и возвращает их число', () => {
        const pool = new ParticlePool(32, createSeededRandom(1));

        const emitted = pool.emitBurst(makeConfig({ count: 10 }));

        expect(emitted).toBe(10);
        expect(pool.aliveCount()).toBe(10);
        expect(pool.hasAlive()).toBe(true);
    });

    it('не превышает capacity и переиспользует те же объекты (нет аллокаций)', () => {
        const pool = new ParticlePool(8, createSeededRandom(1));
        const refsBefore = pool.particlesView.map((p) => p);

        const emitted = pool.emitBurst(makeConfig({ count: 100 }));

        expect(emitted).toBe(8);
        expect(pool.aliveCount()).toBe(8);
        // Тот же массив и те же объекты — ни один не пересоздан
        expect(pool.particlesView).toHaveLength(8);
        pool.particlesView.forEach((p, i) => expect(p).toBe(refsBefore[i]));
    });

    it('после смерти всех частиц новый залп переиспользует старые слоты', () => {
        const pool = new ParticlePool(8, createSeededRandom(1));
        const refsBefore = pool.particlesView.map((p) => p);

        pool.emitBurst(makeConfig({ count: 8, lifeMin: 1, lifeMax: 1 }));
        pool.update(2); // все умерли
        expect(pool.aliveCount()).toBe(0);

        pool.emitBurst(makeConfig({ count: 8 }));

        expect(pool.aliveCount()).toBe(8);
        pool.particlesView.forEach((p, i) => expect(p).toBe(refsBefore[i]));
    });
});

describe('ParticlePool: физика частиц', () => {
    it('update смещает частицу на её скорость за шаг', () => {
        const pool = new ParticlePool(4, createSeededRandom(1));
        pool.emitBurst(makeConfig({ count: 1, gravity: 0 }));
        const p = pool.particlesView.find((particle) => particle.active)!;
        const { x, y, vx, vy } = p;

        pool.update(1);

        expect(p.x).toBeCloseTo(x + vx, 10);
        expect(p.y).toBeCloseTo(y + vy, 10);
    });

    it('гравитация ускоряет вертикальное падение с каждым шагом', () => {
        const pool = new ParticlePool(4, createSeededRandom(1));
        pool.emitBurst(makeConfig({ count: 1, gravity: 0.2 }));
        const p = pool.particlesView.find((particle) => particle.active)!;

        const step1Vy = p.vy;
        pool.update(1);
        const step2Vy = p.vy;
        pool.update(1);

        expect(step2Vy - step1Vy).toBeCloseTo(0.2, 10);
        expect(p.vy - step2Vy).toBeCloseTo(0.2, 10);
    });

    it('частица деактивируется по истечении времени жизни', () => {
        const pool = new ParticlePool(4, createSeededRandom(1));
        pool.emitBurst(makeConfig({ count: 3, lifeMin: 5, lifeMax: 5 }));
        expect(pool.aliveCount()).toBe(3);

        pool.update(4);
        expect(pool.aliveCount()).toBe(3); // ещё живы

        pool.update(2); // 4+2 > 5 — истекли
        expect(pool.aliveCount()).toBe(0);
        expect(pool.hasAlive()).toBe(false);
    });

    it('одинаковый seed даёт идентичное поле частиц (детерминизм)', () => {
        const first = new ParticlePool(16, createSeededRandom(42));
        const second = new ParticlePool(16, createSeededRandom(42));

        first.emitBurst(makeConfig({ count: 12 }));
        second.emitBurst(makeConfig({ count: 12 }));
        for (let i = 0; i < 5; i++) {
            first.update(1);
            second.update(1);
        }

        const snapshot = (pool: ParticlePool) =>
            pool.particlesView.map((p) => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.life }));
        expect(snapshot(first)).toEqual(snapshot(second));
    });

    it('clear гасит все частицы', () => {
        const pool = new ParticlePool(8, createSeededRandom(1));
        pool.emitBurst(makeConfig({ count: 8 }));

        pool.clear();

        expect(pool.aliveCount()).toBe(0);
        expect(pool.particlesView.every((p) => !p.active)).toBe(true);
    });
});

describe('ParticlePool: рендер', () => {
    it('рисует прямоугольник для каждой активной частицы и не создаёт объектов', () => {
        const pool = new ParticlePool(8, createSeededRandom(1));
        pool.emitBurst(makeConfig({ count: 5 }));
        const ctx = {
            fillRect: vi.fn(),
            set globalAlpha(_v: number) {},
            set fillStyle(_v: string) {},
        } as unknown as CanvasRenderingContext2D;

        pool.draw(ctx);

        expect(ctx.fillRect as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(5);
    });

    it('после смерти частиц ничего не рисует', () => {
        const pool = new ParticlePool(8, createSeededRandom(1));
        pool.emitBurst(makeConfig({ count: 5, lifeMin: 1, lifeMax: 1 }));
        pool.update(2);
        const ctx = {
            fillRect: vi.fn(),
            set globalAlpha(_v: number) {},
            set fillStyle(_v: string) {},
        } as unknown as CanvasRenderingContext2D;

        pool.draw(ctx);

        expect(ctx.fillRect as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });
});

describe('Пресеты залпов', () => {
    it('groundBurst летит вверх (vy отрицательный у частиц)', () => {
        const pool = new ParticlePool(64, createSeededRandom(7));

        pool.emitBurst(groundBurst(200, 300));

        const active = pool.particlesView.filter((p) => p.active);
        expect(active.length).toBeGreaterThan(0);
        expect(active.every((p) => p.vy < 0)).toBe(true);
    });

    it('damageFlashBurst разлетается радиально (есть частицы вверх и вниз)', () => {
        const pool = new ParticlePool(64, createSeededRandom(7));

        pool.emitBurst(damageFlashBurst(200, 300));

        const active = pool.particlesView.filter((p) => p.active);
        expect(active.some((p) => p.vy < 0)).toBe(true);
        expect(active.some((p) => p.vy > 0)).toBe(true);
    });

    it('пресеты стартуют из точки взрыва', () => {
        const pool = new ParticlePool(64, createSeededRandom(7));

        pool.emitBurst(groundBurst(150, 250));

        const active = pool.particlesView.filter((p) => p.active);
        expect(active.every((p) => p.x === 150 && p.y === 250)).toBe(true);
    });

    it('count пресета можно уменьшить для деградации на слабых устройствах', () => {
        const pool = new ParticlePool(64, createSeededRandom(7));

        const emitted = pool.emitBurst(groundBurst(150, 250, 6));

        expect(emitted).toBe(6);
    });
});
