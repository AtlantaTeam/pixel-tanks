import { floor } from '@/shared/lib/canvas';
import { ENGINE_COLORS } from './engine-palette';

/**
 * Точка следа снаряда. Неподвижна (в отличие от частиц ParticlePool) — только
 * гаснет по альфе, поэтому «физика» (жизнь) считается прямо в draw(), а не в
 * отдельном update(): рендер и старение здесь неразделимы, как и в Bullet.draw
 * (isPositionChanged/lastX/lastY).
 */
export type TTrailPoint = {
    active: boolean;
    x: number;
    y: number;
    life: number;
    maxLife: number;
    size: number;
    /** Была отрисована в прошлом кадре — перед этим кадром её старый прямоугольник надо очистить. */
    drawn: boolean;
};

export const DEFAULT_TRAIL_CAPACITY = 16;
export const DEFAULT_TRAIL_LIFE = 10;
export const DEFAULT_TRAIL_SIZE = 3;
export const TRAIL_COLOR = ENGINE_COLORS.primary;

/**
 * Затухающий след снаряда: кольцевой буфер снятых по пути точек, каждая живёт
 * несколько кадров и гаснет по альфе. Точки рисуются поверх «неба» вдоль
 * траектории, поэтому каждая точка сама очищает свой прошлый прямоугольник
 * перед перерисовкой — общий fullRedraw на весь полёт снаряда не нужен
 * (правило .claude/rules/canvas.md: не перерисовывать статичные слои каждый
 * кадр). Слоты выделяются один раз в конструкторе, emit/draw их переиспользуют.
 */
export class BulletTrail {
    readonly capacity: number;
    private readonly points: TTrailPoint[];
    private cursor = 0;

    constructor(capacity: number = DEFAULT_TRAIL_CAPACITY) {
        this.capacity = capacity;
        this.points = new Array<TTrailPoint>(capacity);
        for (let i = 0; i < capacity; i++) {
            this.points[i] = {
                active: false,
                x: 0,
                y: 0,
                life: 0,
                maxLife: 0,
                size: 0,
                drawn: false,
            };
        }
    }

    /** Кладёт точку пути в кольцевой буфер, перезаписывая самый старый слот. */
    emit(
        x: number,
        y: number,
        life: number = DEFAULT_TRAIL_LIFE,
        size: number = DEFAULT_TRAIL_SIZE,
    ): void {
        const p = this.points[this.cursor];
        p.active = true;
        p.x = x;
        p.y = y;
        p.life = life;
        p.maxLife = life;
        p.size = size;
        this.cursor = (this.cursor + 1) % this.capacity;
    }

    /** Есть ли точки, которые ещё нужно рисовать или очищать — движок продолжает кадр ради них. */
    hasActive(): boolean {
        // Обычный for вместо .some((p)=>...): без аллокации замыкания на каждый
        // кадр (правило .claude/rules/canvas.md — никаких аллокаций в кадре).
        for (let i = 0; i < this.capacity; i++) {
            const p = this.points[i];
            if (p.active || p.drawn) return true;
        }
        return false;
    }

    /**
     * Очищает прямоугольник, отрисованный прошлым кадром, старит точку и
     * рисует новый кадр с меньшей альфой. Точки, чья жизнь истекла в этом
     * кадре, только очищаются — без повторной отрисовки.
     */
    draw(ctx: CanvasRenderingContext2D, color: string = TRAIL_COLOR): void {
        ctx.fillStyle = color;
        for (const p of this.points) {
            if (p.drawn) {
                ctx.clearRect(floor(p.x - p.size / 2), floor(p.y - p.size / 2), p.size, p.size);
                p.drawn = false;
            }
            if (!p.active) continue;
            ctx.globalAlpha = p.life / p.maxLife;
            ctx.fillRect(floor(p.x - p.size / 2), floor(p.y - p.size / 2), p.size, p.size);
            p.drawn = true;
            p.life -= 1;
            if (p.life <= 0) {
                p.active = false;
            }
        }
        ctx.globalAlpha = 1;
    }

    /** Полный сброс (рестарт боя) — без обращения к canvas. */
    clear(): void {
        for (const p of this.points) {
            p.active = false;
            p.drawn = false;
        }
        this.cursor = 0;
    }

    /** Только для чтения — рендер внутри draw(), наружу для тестов/отладки. */
    get pointsView(): readonly TTrailPoint[] {
        return this.points;
    }
}
