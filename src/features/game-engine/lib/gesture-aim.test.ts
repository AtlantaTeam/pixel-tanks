import { describe, expect, it } from 'vitest';
import { POWER_MAX, POWER_MIN } from '@/shared/config';
import {
    calculateGestureAim,
    clampBubbleAnchorY,
    clampChipCenterX,
    clampChipTop,
    isPointInGestureZone,
    isValidGestureZone,
    type TGestureZone,
} from './gesture-aim';

describe('calculateGestureAim', () => {
    it('возвращает null для короткой оттяжки (тап, а не жест)', () => {
        expect(calculateGestureAim({ x: 100, y: 100 }, { x: 103, y: 101 })).toBeNull();
    });

    it('направление выстрела противоположно оттяжке (рогатка), угол вверх — отрицательный', () => {
        // Оттянули вниз (y растёт) — выстрел вверх (угол отрицательный в canvas-осях).
        const aim = calculateGestureAim({ x: 100, y: 100 }, { x: 100, y: 180 });
        expect(aim).not.toBeNull();
        expect(aim!.angle).toBeCloseTo(-Math.PI / 2);
    });

    it('сила растёт с длиной оттяжки и не превышает максимум', () => {
        const short = calculateGestureAim({ x: 0, y: 0 }, { x: 0, y: 40 });
        const long = calculateGestureAim({ x: 0, y: 0 }, { x: 0, y: 400 });
        expect(short!.power).toBeGreaterThanOrEqual(POWER_MIN);
        expect(short!.power).toBeLessThan(long!.power);
        expect(long!.power).toBe(POWER_MAX);
    });

    it('isMax=false, пока сила ниже максимума', () => {
        const aim = calculateGestureAim({ x: 0, y: 0 }, { x: 0, y: 40 });
        expect(aim!.isMax).toBe(false);
    });

    it('isMax=true при достижении максимума силы (превышение фиксирует силу на powerMax)', () => {
        const aim = calculateGestureAim({ x: 0, y: 0 }, { x: 0, y: 1000 });
        expect(aim!.power).toBe(POWER_MAX);
        expect(aim!.isMax).toBe(true);
    });

    it('детерминирована: одинаковый вход — одинаковый выход', () => {
        const a = calculateGestureAim({ x: 10, y: 20 }, { x: 90, y: 130 });
        const b = calculateGestureAim({ x: 10, y: 20 }, { x: 90, y: 130 });
        expect(a).toEqual(b);
    });
});

describe('isValidGestureZone', () => {
    it('зона с положительной площадью — валидна', () => {
        expect(isValidGestureZone({ top: 100, bottom: 400, left: 10, right: 390 })).toBe(true);
    });

    it('перекрытие по вертикали (короткий landscape) — невалидна', () => {
        // top:242 + bottom-инсет 196 на вьюпорте 375px высотой → bottom(179) < top(242).
        expect(isValidGestureZone({ top: 242, bottom: 179, left: 10, right: 365 })).toBe(false);
    });

    it('вырождение по горизонтали — невалидна', () => {
        expect(isValidGestureZone({ top: 100, bottom: 400, left: 200, right: 200 })).toBe(false);
    });
});

describe('isPointInGestureZone', () => {
    const zone: TGestureZone = { top: 100, bottom: 400, left: 10, right: 390 };

    it('точка внутри зоны', () => {
        expect(isPointInGestureZone({ x: 200, y: 250 }, zone)).toBe(true);
    });

    it('точка над зоной (на верхнем HUD) — не в зоне', () => {
        expect(isPointInGestureZone({ x: 200, y: 50 }, zone)).toBe(false);
    });

    it('точка под зоной (на палубе) — не в зоне', () => {
        expect(isPointInGestureZone({ x: 200, y: 450 }, zone)).toBe(false);
    });

    it('точка за боковой границей — не в зоне', () => {
        expect(isPointInGestureZone({ x: 5, y: 250 }, zone)).toBe(false);
    });
});

describe('clampChipTop', () => {
    const zone: TGestureZone = { top: 100, bottom: 400, left: 10, right: 390 };

    it('чип висит выше пальца, когда место есть', () => {
        expect(clampChipTop(300, zone, 60, 40)).toBe(300 - 40 - 60);
    });

    it('прижимается к верхней границе зоны — не выше HUD', () => {
        // Палец у самого верха зоны: желаемый top ушёл бы над зону.
        expect(clampChipTop(110, zone, 60, 40)).toBe(zone.top);
    });

    it('никогда не уходит под палубу (нижнюю границу зоны)', () => {
        // Палец за нижней границей (pointer capture): чип не ныряет под деку.
        const top = clampChipTop(600, zone, 60, 40);
        expect(top + 60).toBeLessThanOrEqual(zone.bottom);
    });

    it('при зоне уже чипа отдаёт верхнюю границу (чип не под палубой)', () => {
        const narrow: TGestureZone = { top: 100, bottom: 130, left: 10, right: 390 };
        expect(clampChipTop(600, narrow, 60, 40)).toBe(narrow.top);
    });
});

describe('clampChipCenterX', () => {
    const zone: TGestureZone = { top: 100, bottom: 400, left: 10, right: 390 };

    it('следует за пальцем внутри зоны', () => {
        expect(clampChipCenterX(200, zone, 180)).toBe(200);
    });

    it('не вылезает за правую границу зоны', () => {
        expect(clampChipCenterX(380, zone, 180)).toBe(zone.right - 90);
    });

    it('не вылезает за левую границу зоны', () => {
        expect(clampChipCenterX(20, zone, 180)).toBe(zone.left + 90);
    });
});

describe('clampBubbleAnchorY', () => {
    const zone: TGestureZone = { top: 242, bottom: 700, left: 10, right: 390 };

    it('не трогает якорь, если бабл целиком помещается ниже верхнего HUD', () => {
        expect(clampBubbleAnchorY(500, zone, 90)).toBe(500);
    });

    it('прижимает якорь так, чтобы верх бабла не заходил в верхний HUD', () => {
        // Танк близко к верхнему оверлею (rawY=260) — бабл высотой 90 задел бы
        // зону HUD (260 - 90 = 170 < 242). Якорь прижимается к zone.top + height.
        expect(clampBubbleAnchorY(260, zone, 90)).toBe(zone.top + 90);
    });
});
