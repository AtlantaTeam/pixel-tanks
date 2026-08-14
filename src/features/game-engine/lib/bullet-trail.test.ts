import { describe, expect, it, vi } from 'vitest';
import { BulletTrail, DEFAULT_TRAIL_CAPACITY } from './bullet-trail';

const makeCtx = () => ({
    fillStyle: '',
    globalAlpha: 1,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
});

const asCtx = (ctx: ReturnType<typeof makeCtx>) => ctx as unknown as CanvasRenderingContext2D;

describe('BulletTrail: затухающий след без аллокаций', () => {
    it('предвыделяет ровно capacity точек, изначально ни одна не активна', () => {
        const trail = new BulletTrail(10);

        expect(trail.capacity).toBe(10);
        expect(trail.pointsView).toHaveLength(10);
        expect(trail.pointsView.every((p) => !p.active)).toBe(true);
        expect(trail.hasActive()).toBe(false);
    });

    it('использует ёмкость по умолчанию, если не передана явно', () => {
        const trail = new BulletTrail();

        expect(trail.capacity).toBe(DEFAULT_TRAIL_CAPACITY);
    });

    it('emit активирует точку в текущей позиции курсора', () => {
        const trail = new BulletTrail(4);

        trail.emit(10, 20);

        expect(trail.hasActive()).toBe(true);
        expect(trail.pointsView[0]).toMatchObject({ active: true, x: 10, y: 20 });
    });

    it('emit по кругу переиспользует те же объекты (нет аллокаций)', () => {
        const trail = new BulletTrail(2);
        const refsBefore = trail.pointsView.map((p) => p);

        trail.emit(1, 1);
        trail.emit(2, 2);
        trail.emit(3, 3);

        expect(trail.pointsView.map((p) => p)).toEqual(refsBefore);
        // Третий emit перезаписал первый слот (курсор пошёл по кругу).
        expect(trail.pointsView[0]).toMatchObject({ x: 3, y: 3 });
        expect(trail.pointsView[1]).toMatchObject({ x: 2, y: 2 });
    });

    it('draw рисует активную точку с альфой = life/maxLife и уменьшает жизнь', () => {
        const trail = new BulletTrail(4);
        const ctx = makeCtx();
        trail.emit(5, 5, 4, 2);

        trail.draw(asCtx(ctx));

        expect(ctx.fillRect).toHaveBeenCalledWith(4, 4, 2, 2);
        expect(trail.pointsView[0].life).toBe(3);
    });

    it('гасит точку, когда жизнь заканчивается, и на следующий кадр только очищает её', () => {
        const trail = new BulletTrail(4);
        const ctx = makeCtx();
        trail.emit(5, 5, 1, 2);

        trail.draw(asCtx(ctx)); // life 1 -> 0, точка гаснет, но была отрисована в этом кадре
        expect(trail.pointsView[0].active).toBe(false);
        expect(trail.hasActive()).toBe(true); // drawn=true — нужен ещё кадр на очистку

        ctx.clearRect.mockClear();
        ctx.fillRect.mockClear();
        trail.draw(asCtx(ctx)); // второй кадр: только очищает прошлый прямоугольник

        expect(ctx.clearRect).toHaveBeenCalledWith(4, 4, 2, 2);
        expect(ctx.fillRect).not.toHaveBeenCalled();
        expect(trail.hasActive()).toBe(false);
    });

    it('толщина бокса убывает от головы к хвосту следа (комета, а не цепочка одинаковых квадратов)', () => {
        const trail = new BulletTrail(4);
        const ctx = makeCtx();
        trail.emit(5, 5, 4, 8);

        trail.draw(asCtx(ctx)); // life 4/4 — голова следа, самый толстый кадр
        const headSize = ctx.fillRect.mock.calls[0][2];

        ctx.fillRect.mockClear();
        trail.draw(asCtx(ctx));
        trail.draw(asCtx(ctx));
        trail.draw(asCtx(ctx)); // life 1/4 — последний кадр перед гашением, самый тонкий
        const tailSize = ctx.fillRect.mock.calls.at(-1)![2];

        expect(tailSize).toBeLessThan(headSize);
        expect(tailSize).toBeGreaterThanOrEqual(1); // пол в 1px — хвост не схлопывается в невидимую точку
    });

    it('очищает прошлым кадром нарисованный (больший) бокс, а не текущий уменьшившийся размер', () => {
        const trail = new BulletTrail(4);
        const ctx = makeCtx();
        trail.emit(10, 10, 2, 8); // maxLife 2: первый кадр size=8, второй — уже меньше

        trail.draw(asCtx(ctx)); // рисует полноразмерный бокс 8×8, life 2 -> 1
        const firstDrawnSize = ctx.fillRect.mock.calls[0][2];
        expect(firstDrawnSize).toBe(8);

        ctx.clearRect.mockClear();
        ctx.fillRect.mockClear();
        trail.draw(asCtx(ctx)); // life 1 -> 0: сначала чистит бокс прошлого кадра (8×8), потом рисует меньший

        const [, , clearedW, clearedH] = ctx.clearRect.mock.calls[0];
        expect(clearedW).toBe(firstDrawnSize);
        expect(clearedH).toBe(firstDrawnSize);

        const newDrawnSize = ctx.fillRect.mock.calls[0][2];
        expect(newDrawnSize).toBeLessThan(firstDrawnSize);
    });

    it('доливает интерполированные точки, когда снаряд между кадрами проходит больше своего размера', () => {
        const trail = new BulletTrail(32);

        trail.emit(0, 0, 10, 2); // первая точка следа — интерполировать пока не от чего
        trail.emit(40, 0, 10, 2); // быстрый снаряд: разрыв 40px при размере точки 2px

        const active = trail.pointsView.filter((p) => p.active);
        // Голова (40,0) + минимум одна доливка между (0,0) и (40,0) — иначе разрыв виден как есть.
        expect(active.length).toBeGreaterThan(2);

        const xs = active.map((p) => p.x).sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) {
            expect(xs[i] - xs[i - 1]).toBeLessThan(40);
        }
    });

    it('не доливает точки, если снаряд между кадрами не выходит за размер точки', () => {
        const trail = new BulletTrail(32);

        trail.emit(0, 0, 10, 8);
        trail.emit(3, 0, 10, 8); // разрыв 3px меньше размера точки (8px)

        expect(trail.pointsView.filter((p) => p.active)).toHaveLength(2);
    });

    it('clear гасит все точки без обращения к canvas', () => {
        const trail = new BulletTrail(4);
        trail.emit(1, 1);
        trail.emit(2, 2);

        trail.clear();

        expect(trail.hasActive()).toBe(false);
        expect(trail.pointsView.every((p) => !p.active && !p.drawn)).toBe(true);
    });
});
