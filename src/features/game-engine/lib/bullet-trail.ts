import { POWER_MAX } from '@/shared/config';
import { floor } from '@/shared/lib/canvas';
import { ENGINE_COLORS } from './engine-palette';
import { WEAPON_SPECS } from './weapon-specs';

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
    /** Размер точки в момент emit (голова следа) — от него убывает отрисованный бокс. */
    size: number;
    /** Была отрисована в прошлом кадре — перед этим кадром её старый прямоугольник надо очистить. */
    drawn: boolean;
    /** Сторона бокса, фактически нарисованного в прошлом кадре (для точной очистки — она меньше `size`, когда точка уже старела). */
    drawnSize: number;
};

/**
 * Пределы следов из таблицы оружия (`weapon-specs.ts`) — выведены, а не вписаны
 * числом, чтобы кап доливки и ёмкость буфера не разъезжались при перетюне весов.
 */
const TRAIL_SPECS = Object.values(WEAPON_SPECS).map((s) => s.trail);
/** Самый долгоживущий след (кадры) — задаёт нижнюю границу ёмкости кольца. */
const MAX_TRAIL_LIFE_FRAMES = Math.max(...TRAIL_SPECS.map((t) => t.life));
/** Самый тонкий след — на нём разрывы видны раньше всего, по нему считаем кап доливки. */
const MIN_TRAIL_SIZE = Math.min(...TRAIL_SPECS.map((t) => t.size));

/**
 * Максимальный разрыв точек следа между кадрами: скорость снаряда = сила выстрела
 * (`Bullet`: dx=cos·power, dy=sin·power ⇒ |v| = power ≤ POWER_MAX px/кадр). Снос ветром
 * и гравитацией за один кадр пренебрежимо мал рядом с этим потолком, а сам `power`
 * жёстко зажат `clampPower` — быстрее снаряд не летит.
 */
const MAX_GAP_PER_FRAME = POWER_MAX;

/**
 * Максимум точек, доливаемых интерполяцией МЕЖДУ прошлым и текущим `emit` за один кадр
 * (issue #570): без неё быстрый снаряд (шаг больше своего размера) кладёт след с
 * разрывами — отдельные квадраты вместо сплошной линии. Кап выведен из требования
 * непрерывности «шаг ≤ size» для самого тонкого следа на макс. скорости: при доливке
 * spacing = gap/(steps+1), и `ceil` гарантирует spacing ≤ size, когда steps+1 ≥ gap/size.
 * Значит на скоростях ≤ POWER_MAX даже тончайший след остаётся сплошным; быстрее физика
 * снаряд не пускает, а выше капа кадр не разъедал бы полкольца буфера.
 */
const MAX_TRAIL_INTERPOLATION_STEPS = Math.max(
    1,
    Math.ceil(MAX_GAP_PER_FRAME / MIN_TRAIL_SIZE) - 1,
);

/**
 * Ёмкость кольцевого буфера (issue #570). Слот переиспользуется курсором ПО КРУГУ без
 * проверки, погасла ли точка в нём, поэтому буфер обязан перекрывать полный оборот:
 * (макс. точек за кадр) × (кадров жизни точки + 1 на дочистку). Берём пессимистичное
 * произведение — макс. частоту доливки (тончайший след) и макс. жизнь (самый долгий
 * след) вместе, хотя одно оружие их не совмещает: это даёт ~2× запас над реальным
 * худшим весом и, будучи формулой от `WEAPON_SPECS`/`POWER_MAX`, не протухает при
 * правке оружия.
 */
export const DEFAULT_TRAIL_CAPACITY =
    (MAX_TRAIL_INTERPOLATION_STEPS + 1) * (MAX_TRAIL_LIFE_FRAMES + 1);
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
    /** Позиция предыдущего `emit` — точка, от которой тянем интерполяцию. `null`, пока следа ещё нет (первый emit, или после `clear`). */
    private lastEmitX: number | null = null;
    private lastEmitY: number | null = null;

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
                drawnSize: 0,
            };
        }
    }

    /** Кладёт точку в конкретный слот кольцевого буфера — общая часть `emit` и интерполяции между её точками. */
    private place(x: number, y: number, life: number, size: number): void {
        const p = this.points[this.cursor];
        p.active = true;
        p.x = x;
        p.y = y;
        p.life = life;
        p.maxLife = life;
        p.size = size;
        this.cursor = (this.cursor + 1) % this.capacity;
    }

    /**
     * Кладёт точку пути в кольцевой буфер, перезаписывая самый старый слот.
     * Быстрый снаряд между двумя кадрами проходит больше своего размера — без
     * доливки след распадается на отдельные квадраты с зазорами (issue #570).
     * Поэтому, если разрыв с прошлой точкой больше `size`, отрезок между ними
     * доливается интерполированными точками (той же жизни — они того же кадра).
     */
    emit(
        x: number,
        y: number,
        life: number = DEFAULT_TRAIL_LIFE,
        size: number = DEFAULT_TRAIL_SIZE,
    ): void {
        if (this.lastEmitX !== null && this.lastEmitY !== null && size > 0) {
            const dx = x - this.lastEmitX;
            const dy = y - this.lastEmitY;
            const distance = Math.hypot(dx, dy);
            if (distance > size) {
                // `ceil(distance/size) - 1` доливок даёт spacing = distance/(steps+1) ≤ size
                // (сплошной след, #570); кап держит буфер при разрыве выше макс. скорости.
                const steps = Math.min(
                    MAX_TRAIL_INTERPOLATION_STEPS,
                    Math.ceil(distance / size) - 1,
                );
                for (let i = 1; i <= steps; i++) {
                    const t = i / (steps + 1);
                    this.place(this.lastEmitX + dx * t, this.lastEmitY + dy * t, life, size);
                }
            }
        }
        this.place(x, y, life, size);
        this.lastEmitX = x;
        this.lastEmitY = y;
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
     *
     * Толщина бокса убывает вместе с жизнью точки (голова следа толще хвоста —
     * иначе это цепочка одинаковых квадратов, а не сужающаяся комета, issue #570),
     * с полом в 1px, чтобы самый хвост не схлопывался в невидимую точку. Очистка
     * прошлого кадра идёт по `drawnSize` — размеру, который реально был на
     * экране, а не по текущему (уже меньшему) `size`: иначе от уменьшающегося
     * бокса на канве остаётся неочищенный ободок прежней, большей площади.
     */
    draw(ctx: CanvasRenderingContext2D, color: string = TRAIL_COLOR): void {
        ctx.fillStyle = color;
        for (const p of this.points) {
            if (p.drawn) {
                ctx.clearRect(
                    floor(p.x - p.drawnSize / 2),
                    floor(p.y - p.drawnSize / 2),
                    p.drawnSize,
                    p.drawnSize,
                );
                p.drawn = false;
            }
            if (!p.active) continue;
            const ratio = p.life / p.maxLife;
            ctx.globalAlpha = ratio;
            const drawSize = Math.max(1, Math.floor(p.size * ratio));
            ctx.fillRect(floor(p.x - drawSize / 2), floor(p.y - drawSize / 2), drawSize, drawSize);
            p.drawnSize = drawSize;
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
        this.lastEmitX = null;
        this.lastEmitY = null;
    }

    /** Только для чтения — рендер внутри draw(), наружу для тестов/отладки. */
    get pointsView(): readonly TTrailPoint[] {
        return this.points;
    }
}
