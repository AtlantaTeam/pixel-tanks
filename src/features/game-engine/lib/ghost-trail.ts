import { floor } from '@/shared/lib/canvas';

/** Точка призрачной трассы — только координаты, без времени жизни (трасса не гаснет сама). */
type TGhostPoint = { x: number; y: number };

/** Сколько узлов трассы держим — децимация (см. `stride`) не даёт длинным полётам (отскоки от стен) переполнить буфер. */
const DEFAULT_GHOST_CAPACITY = 96;
/** Тиков физики между соседними записанными узлами — длинный полёт даёт более редкую трассу, а не переполнение буфера. */
const DEFAULT_GHOST_STRIDE = 2;
/** Альфа линии и креста трассы (issue #543: «пунктир ~35%»). */
export const GHOST_TRAIL_ALPHA = 0.35;
/** Толщина линии трассы, CSS px. */
const GHOST_LINE_WIDTH = 2;
/** Сторона креста в точке попадания, CSS px (issue #543: «крест 8×8»). */
const GHOST_CROSS_SIZE = 8;
/** Шаг тире в мировых единицах — `draw` умножает на масштаб мира (issue #543: «шаг тире кратен масштабу мира»). */
const GHOST_DASH_WORLD_UNIT = 4;
/** Общая на все трассы пустая пара для сброса `setLineDash` — без аллокации на кадр. */
const NO_DASH: readonly number[] = [];

/**
 * Призрачная трасса прошлого выстрела (issue #543): пунктирная линия вдоль
 * РЕАЛЬНО пройденного пути снаряда плюс крест в точке попадания. В отличие от
 * `BulletTrail` (затухающий след текущего полёта) эта трасса не угасает сама —
 * живёт до explicit `commit()`/`clear()` следующего события хода (правило
 * владения — на стороне `GamePlay`, см. `moveBullet`/`fire`).
 *
 * Точки — **записанные во время реального полёта** (`record`, зовётся из
 * `moveBullet` тем же кадром, что и `BulletTrail.emit`), а не пересчитанная
 * дуга (как `fillTrajectoryPreview`): реплей-детерминизм не тронут — трасса
 * показывает то, что фактически случилось, не новую симуляцию.
 *
 * Пишущий (`recording`) и показываемый (`committed`) буферы преаллоцированы и
 * держатся раздельно, `commit()` меняет их местами (своп ссылок, не аллокация
 * в кадре — `.claude/rules/canvas.md`): запись следующего выстрела не портит
 * ещё видимую трассу предыдущего.
 */
export class GhostTrail {
    private recording: TGhostPoint[];
    private committed: TGhostPoint[];
    private recordCount = 0;
    private committedCount = 0;
    private recordStrideCounter = 0;
    private readonly stride: number;
    /** Точка попадания записывается на КАЖДЫЙ `record`, а не только по страйду — крест не размывается децимацией. */
    private impactX = 0;
    private impactY = 0;
    private committedImpactX = 0;
    private committedImpactY = 0;
    private active = false;

    constructor(capacity: number = DEFAULT_GHOST_CAPACITY, stride: number = DEFAULT_GHOST_STRIDE) {
        this.stride = Math.max(1, stride);
        this.recording = Array.from({ length: capacity }, () => ({ x: 0, y: 0 }));
        this.committed = Array.from({ length: capacity }, () => ({ x: 0, y: 0 }));
    }

    /** Есть видимая (закоммиченная) трасса — рендер и точечные перерисовки читают этот флаг. */
    get isActive(): boolean {
        return this.active;
    }

    /** Только для чтения — видимые узлы трассы (тесты/отладка). */
    get committedView(): readonly TGhostPoint[] {
        return this.committed.slice(0, this.committedCount);
    }

    /** Начинает запись нового полёта. Видимую (закоммиченную) трассу не трогает. */
    beginRecording(): void {
        this.recordCount = 0;
        // Взведён так, чтобы САМАЯ ПЕРВАЯ точка нового полёта записалась сразу
        // (трасса начинается у ствола, не спустя `stride` тиков после него).
        this.recordStrideCounter = this.stride - 1;
    }

    /** Кладёт точку пути (зовётся, пока снаряд летит и не детонировал). */
    record(x: number, y: number): void {
        this.impactX = x;
        this.impactY = y;
        this.recordStrideCounter += 1;
        if (this.recordStrideCounter < this.stride) return;
        this.recordStrideCounter = 0;
        if (this.recordCount >= this.recording.length) return;
        const p = this.recording[this.recordCount];
        p.x = x;
        p.y = y;
        this.recordCount += 1;
    }

    /** Публикует записанный путь как видимую трассу — заменяет прошлую. */
    commit(): void {
        [this.recording, this.committed] = [this.committed, this.recording];
        this.committedCount = this.recordCount;
        this.committedImpactX = this.impactX;
        this.committedImpactY = this.impactY;
        this.active = this.committedCount > 0;
    }

    /** Гасит видимую трассу без ожидания следующего выстрела (правило владения хода). */
    clear(): void {
        this.active = false;
    }

    /**
     * Рисует пунктирную линию по трассе плюс крест в точке попадания. `dashUnit`
     * — уже готовый шаг тире в CSS px (вызывающий сам умножает мировую единицу
     * на масштаб мира, `GamePlay.drawGhostTrails`).
     */
    draw(ctx: CanvasRenderingContext2D, color: string, dashUnit: number): void {
        if (!this.active) return;
        if (this.committedCount >= 2) {
            ctx.save();
            ctx.globalAlpha = GHOST_TRAIL_ALPHA;
            ctx.strokeStyle = color;
            ctx.lineWidth = GHOST_LINE_WIDTH;
            ctx.setLineDash([dashUnit, dashUnit]);
            ctx.beginPath();
            ctx.moveTo(this.committed[0].x, this.committed[0].y);
            for (let i = 1; i < this.committedCount; i++) {
                ctx.lineTo(this.committed[i].x, this.committed[i].y);
            }
            ctx.stroke();
            ctx.setLineDash(NO_DASH as number[]);
            ctx.restore();
        }
        this.drawImpactCross(ctx, color);
    }

    private drawImpactCross(ctx: CanvasRenderingContext2D, color: string): void {
        const half = GHOST_CROSS_SIZE / 2;
        const x = floor(this.committedImpactX);
        const y = floor(this.committedImpactY);
        ctx.save();
        ctx.globalAlpha = GHOST_TRAIL_ALPHA;
        ctx.strokeStyle = color;
        ctx.lineWidth = GHOST_LINE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(x - half, y - half);
        ctx.lineTo(x + half, y + half);
        ctx.moveTo(x + half, y - half);
        ctx.lineTo(x - half, y + half);
        ctx.stroke();
        ctx.restore();
    }
}

/** Шаг тире трассы в CSS px под масштаб мира (issue #543) — `GamePlay` вызывает при рисовании. */
export function ghostDashUnit(scale: number): number {
    return Math.max(1, floor(GHOST_DASH_WORLD_UNIT * scale));
}
