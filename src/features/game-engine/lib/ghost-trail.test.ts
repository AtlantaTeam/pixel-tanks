import { describe, expect, it, vi } from 'vitest';
import { GhostTrail, GHOST_TRAIL_ALPHA, ghostDashUnit } from './ghost-trail';

const makeCtx = () => ({
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    globalAlpha: 1,
    strokeStyle: '',
    lineWidth: 1,
});

const asCtx = (ctx: ReturnType<typeof makeCtx>) => ctx as unknown as CanvasRenderingContext2D;

describe('GhostTrail: призрачная трасса прошлого выстрела (#543)', () => {
    it('изначально неактивна — draw ничего не рисует', () => {
        const trail = new GhostTrail();
        const ctx = makeCtx();

        expect(trail.isActive).toBe(false);
        trail.draw(asCtx(ctx), '#48ff00', 4);

        expect(ctx.stroke).not.toHaveBeenCalled();
        expect(ctx.save).not.toHaveBeenCalled();
    });

    it('record без commit не активирует видимую трассу', () => {
        const trail = new GhostTrail(96, 1);

        trail.beginRecording();
        trail.record(10, 20);
        trail.record(30, 40);

        expect(trail.isActive).toBe(false);
        expect(trail.committedView).toHaveLength(0);
    });

    it('commit публикует записанный путь как видимую трассу', () => {
        const trail = new GhostTrail(96, 1);

        trail.beginRecording();
        trail.record(0, 0);
        trail.record(2, 2);
        trail.record(4, 4);
        trail.commit();

        expect(trail.isActive).toBe(true);
        expect(trail.committedView).toEqual([
            { x: 0, y: 0 },
            { x: 2, y: 2 },
            { x: 4, y: 4 },
        ]);
    });

    it('децимация (stride) прореживает узлы, не теряя порядок пути', () => {
        // stride=3: из точек 0..8 попадают в буфер только каждая третья (0, 3, 6).
        const trail = new GhostTrail(96, 3);

        trail.beginRecording();
        for (let x = 0; x < 9; x++) trail.record(x, x);
        trail.commit();

        expect(trail.committedView).toEqual([
            { x: 0, y: 0 },
            { x: 3, y: 3 },
            { x: 6, y: 6 },
        ]);
    });

    it('переполнение ёмкости просто перестаёт добавлять узлы (без падения/аллокации)', () => {
        const trail = new GhostTrail(3, 1);

        trail.beginRecording();
        for (let x = 0; x < 10; x++) trail.record(x, x);
        trail.commit();

        expect(trail.committedView).toHaveLength(3);
        expect(trail.committedView).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 2 },
        ]);
    });

    it('точка попадания — последняя реально записанная позиция, даже если её съела децимация или переполнение', () => {
        // Точка попадания обязана быть точной вне зависимости от stride/ёмкости —
        // record() обновляет её на КАЖДЫЙ вызов, не только на попавшие в буфер.
        const trail = new GhostTrail(3, 5);

        trail.beginRecording();
        for (let x = 0; x <= 12; x++) trail.record(x, x * 2);
        trail.commit();

        const ctx = makeCtx();
        trail.draw(asCtx(ctx), '#48ff00', 4);

        // Крест рисуется вокруг (12, 24) — последней позиции.
        expect(ctx.moveTo).toHaveBeenCalledWith(12 - 4, 24 - 4);
    });

    it('beginRecording нового полёта не трогает уже видимую (закоммиченную) трассу', () => {
        const trail = new GhostTrail(96, 1);
        trail.beginRecording();
        trail.record(1, 1);
        trail.record(2, 2);
        trail.commit();
        const committedBefore = trail.committedView;

        trail.beginRecording();
        trail.record(99, 99);

        expect(trail.isActive).toBe(true);
        expect(trail.committedView).toEqual(committedBefore);
    });

    it('clear гасит видимую трассу немедленно', () => {
        const trail = new GhostTrail();
        trail.beginRecording();
        trail.record(1, 1);
        trail.record(2, 2);
        trail.commit();

        trail.clear();

        expect(trail.isActive).toBe(false);
    });

    it('commit без единой записанной точки не активирует трассу', () => {
        const trail = new GhostTrail();

        trail.beginRecording();
        trail.commit();

        expect(trail.isActive).toBe(false);
    });

    it('draw с ≥2 узлами рисует пунктирную линию нужным цветом/альфой и крест в точке попадания', () => {
        const trail = new GhostTrail(96, 1);
        trail.beginRecording();
        trail.record(0, 0);
        trail.record(10, 0);
        trail.commit();
        const ctx = makeCtx();

        trail.draw(asCtx(ctx), '#c900ff', 4);

        expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
        expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
        expect(ctx.lineTo).toHaveBeenCalledWith(10, 0);
        expect(ctx.stroke).toHaveBeenCalled();
        // save/restore пары: одна на линию, одна на крест.
        expect(ctx.save).toHaveBeenCalledTimes(2);
        expect(ctx.restore).toHaveBeenCalledTimes(2);
    });

    it('draw с одной точкой рисует только крест попадания, без линии', () => {
        const trail = new GhostTrail();
        trail.beginRecording();
        trail.record(5, 5);
        trail.commit();
        const ctx = makeCtx();

        trail.draw(asCtx(ctx), '#48ff00', 4);

        expect(ctx.setLineDash).not.toHaveBeenCalled();
        expect(ctx.save).toHaveBeenCalledTimes(1);
        // Крест — два moveTo/lineTo (диагонали).
        expect(ctx.moveTo).toHaveBeenCalledTimes(2);
    });
});

describe('ghostDashUnit: шаг тире кратен масштабу мира (#543)', () => {
    it('масштабирует базовый шаг тире масштабом мира', () => {
        expect(ghostDashUnit(1)).toBeGreaterThan(0);
        expect(ghostDashUnit(2)).toBeGreaterThan(ghostDashUnit(1));
    });

    it('не вырождается в ноль на минимальном масштабе', () => {
        expect(ghostDashUnit(0.1)).toBeGreaterThanOrEqual(1);
    });
});

describe('GHOST_TRAIL_ALPHA', () => {
    it('держит трассу заметно прозрачной (~35%, issue #543)', () => {
        expect(GHOST_TRAIL_ALPHA).toBeCloseTo(0.35, 5);
    });
});
