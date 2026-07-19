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

    it('clear гасит все точки без обращения к canvas', () => {
        const trail = new BulletTrail(4);
        trail.emit(1, 1);
        trail.emit(2, 2);

        trail.clear();

        expect(trail.hasActive()).toBe(false);
        expect(trail.pointsView.every((p) => !p.active && !p.drawn)).toBe(true);
    });
});
