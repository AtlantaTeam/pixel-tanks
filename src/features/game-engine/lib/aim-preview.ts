import type { TCoords } from '@/shared/model';

export type TAimPreviewOptions = {
    /** Минимальная длина линии прицела в px (даже при power = powerMin) */
    minLength: number;
    /** Сколько px длины добавляет одна единица мощности */
    lengthPerPower: number;
    /** Расстояние между точками пунктирной линии в px */
    dotSpacing: number;
};

export const AIM_PREVIEW_DEFAULTS: TAimPreviewOptions = {
    minLength: 20,
    lengthPerPower: 8,
    dotSpacing: 10,
};

/**
 * Пиксельная пунктирная линия прицела вдоль угла ствола: длина растёт
 * с мощностью выстрела, как в оригинальной Pocket Tanks.
 */
export function calculateAimPreviewDots(
    from: TCoords,
    angle: number,
    power: number,
    options: Partial<TAimPreviewOptions> = {},
): TCoords[] {
    const { minLength, lengthPerPower, dotSpacing } = { ...AIM_PREVIEW_DEFAULTS, ...options };
    const length = minLength + power * lengthPerPower;
    const dotsCount = Math.floor(length / dotSpacing);
    const dots: TCoords[] = [];
    for (let i = 1; i <= dotsCount; i++) {
        const distance = i * dotSpacing;
        dots.push({
            x: from.x + distance * Math.cos(angle),
            y: from.y + distance * Math.sin(angle),
        });
    }
    return dots;
}
