import type { TCoords } from '@/shared/model';

export type TDragAim = {
    angle: number;
    power: number;
};

export type TDragAimOptions = {
    /** Порог в px, ниже которого жест считается случайным тапом, а не оттяжкой */
    minDragDistance: number;
    /** Сколько px оттяжки дают одну единицу мощности */
    pixelsPerPowerUnit: number;
    powerMin: number;
    powerMax: number;
};

export const DRAG_AIM_DEFAULTS: TDragAimOptions = {
    minDragDistance: 10,
    pixelsPerPowerUnit: 8,
    powerMin: 1,
    powerMax: 20,
};

/**
 * Слингшот «оттяни и отпусти»: выстрел направлен противоположно вектору
 * оттяжки (как в рогатке), длина оттяжки задаёт мощность.
 * Координаты — canvas (ось Y вниз), поэтому выстрел вверх — отрицательный угол.
 */
export function calculateDragAim(
    start: TCoords,
    current: TCoords,
    options: Partial<TDragAimOptions> = {},
): TDragAim | null {
    const { minDragDistance, pixelsPerPowerUnit, powerMin, powerMax } = {
        ...DRAG_AIM_DEFAULTS,
        ...options,
    };
    const aimDx = start.x - current.x;
    const aimDy = start.y - current.y;
    const distance = Math.hypot(aimDx, aimDy);
    if (distance < minDragDistance) return null;

    return {
        angle: Math.atan2(aimDy, aimDx),
        power: Math.min(powerMax, Math.max(powerMin, Math.round(distance / pixelsPerPowerUnit))),
    };
}
