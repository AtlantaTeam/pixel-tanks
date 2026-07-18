import { floor } from '@/shared/lib/canvas';
import type { TSeededRandom } from '@/shared/lib/random';

/**
 * Частица пула. Это переиспользуемый мутабельный слот, а НЕ создаваемый в кадре
 * объект: пул выделяет их один раз в конструкторе, а emit/update лишь меняют поля.
 * Время (`life`, `maxLife`) измеряется в «фреймах» — движок шагает покадрово,
 * как и вся остальная физика (`Bullet.move` без dt).
 */
export type TParticle = {
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** Оставшееся время жизни во «фреймах» */
    life: number;
    maxLife: number;
    size: number;
    gravity: number;
    color: string;
};

/** Описание залпа частиц: диапазоны разброса, из которых сэмплируется каждая частица. */
export type TBurstConfig = {
    x: number;
    y: number;
    count: number;
    colors: string[];
    speedMin: number;
    speedMax: number;
    /** Угол разлёта в радианах (canvas: y растёт вниз, вверх — отрицательный) */
    angleMin: number;
    angleMax: number;
    lifeMin: number;
    lifeMax: number;
    sizeMin: number;
    sizeMax: number;
    gravity: number;
};

export const DEFAULT_PARTICLE_CAPACITY = 128;

/** Земляной цвет комьев из воронки взрыва (палитра песка/грунта). */
export const GROUND_PARTICLE_COLORS = ['#c2703d', '#a35a2a', '#e8b06a', '#6b3f1d'];
/** Яркая вспышка урона при попадании в танк (палитра Pico-8). */
export const DAMAGE_PARTICLE_COLORS = ['#ff004d', '#ffa300', '#ffec27', '#ffffff'];

/**
 * Залп земли из воронки: комья летят вверх широким веером и падают обратно
 * под гравитацией. Меньший `count` — деградация для слабых устройств.
 */
export function groundBurst(x: number, y: number, count = 24): TBurstConfig {
    return {
        x,
        y,
        count,
        colors: GROUND_PARTICLE_COLORS,
        speedMin: 1.5,
        speedMax: 5,
        angleMin: -Math.PI * 0.85,
        angleMax: -Math.PI * 0.15,
        lifeMin: 22,
        lifeMax: 42,
        sizeMin: 2,
        sizeMax: 4,
        gravity: 0.18,
    };
}

/**
 * Вспышка урона при прямом попадании в танк: искры разлетаются радиально,
 * ярко и коротко, почти без гравитации.
 */
export function damageFlashBurst(x: number, y: number, count = 26): TBurstConfig {
    return {
        x,
        y,
        count,
        colors: DAMAGE_PARTICLE_COLORS,
        speedMin: 2,
        speedMax: 6,
        angleMin: -Math.PI,
        angleMax: Math.PI,
        lifeMin: 14,
        lifeMax: 28,
        sizeMin: 2,
        sizeMax: 3,
        gravity: 0.05,
    };
}

/**
 * Пул частиц с фиксированной ёмкостью. Все слоты выделяются один раз в
 * конструкторе; emit/update/draw переиспользуют их и НЕ создают объектов в
 * кадре (правило .claude/rules/canvas.md). Random инжектируется — поле частиц
 * детерминировано при одинаковом seed (нужно для реплеев и тестов).
 */
export class ParticlePool {
    readonly capacity: number;
    private readonly particles: TParticle[];
    private readonly random: TSeededRandom;
    private alive = 0;

    constructor(capacity: number, random: TSeededRandom) {
        this.capacity = capacity;
        this.random = random;
        this.particles = new Array<TParticle>(capacity);
        for (let i = 0; i < capacity; i++) {
            this.particles[i] = {
                active: false,
                x: 0,
                y: 0,
                vx: 0,
                vy: 0,
                life: 0,
                maxLife: 0,
                size: 0,
                gravity: 0,
                color: '',
            };
        }
    }

    private rand(min: number, max: number): number {
        return min + this.random() * (max - min);
    }

    /**
     * Активирует до `config.count` свободных слотов, сэмплируя параметры из
     * диапазонов залпа. Возвращает фактически выпущенное число (может быть
     * меньше count, если пул заполнен). Аллокаций нет — только запись полей.
     */
    emitBurst(config: TBurstConfig): number {
        let emitted = 0;
        for (let i = 0; i < this.capacity && emitted < config.count; i++) {
            const p = this.particles[i];
            if (p.active) continue;
            const angle = this.rand(config.angleMin, config.angleMax);
            const speed = this.rand(config.speedMin, config.speedMax);
            p.active = true;
            p.x = config.x;
            p.y = config.y;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed;
            p.maxLife = this.rand(config.lifeMin, config.lifeMax);
            p.life = p.maxLife;
            p.size = this.rand(config.sizeMin, config.sizeMax);
            p.gravity = config.gravity;
            p.color = config.colors[floor(this.random() * config.colors.length)];
            emitted++;
        }
        this.alive += emitted;
        return emitted;
    }

    /** Шаг симуляции: гравитация → скорость → позиция; истёкшие гасит. `dt` во «фреймах». */
    update(dt = 1): void {
        let alive = 0;
        for (let i = 0; i < this.capacity; i++) {
            const p = this.particles[i];
            if (!p.active) continue;
            p.life -= dt;
            if (p.life <= 0) {
                p.active = false;
                continue;
            }
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            alive++;
        }
        this.alive = alive;
    }

    /** Рисует активные частицы пиксельными квадратами, затухающими к концу жизни. */
    draw(ctx: CanvasRenderingContext2D): void {
        for (let i = 0; i < this.capacity; i++) {
            const p = this.particles[i];
            if (!p.active) continue;
            const size = Math.max(1, floor(p.size));
            ctx.globalAlpha = p.life / p.maxLife;
            ctx.fillStyle = p.color;
            ctx.fillRect(floor(p.x - size / 2), floor(p.y - size / 2), size, size);
        }
        ctx.globalAlpha = 1;
    }

    aliveCount(): number {
        return this.alive;
    }

    hasAlive(): boolean {
        return this.alive > 0;
    }

    /** Гасит все частицы (сброс при рестарте боя). */
    clear(): void {
        for (let i = 0; i < this.capacity; i++) {
            this.particles[i].active = false;
        }
        this.alive = 0;
    }

    /** Только для чтения — рендер внутри draw(), наружу для тестов/отладки. */
    get particlesView(): readonly TParticle[] {
        return this.particles;
    }
}
