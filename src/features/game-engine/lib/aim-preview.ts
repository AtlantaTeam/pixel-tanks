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
 *
 * `out` — необязательный буфер для переиспользования (правило .claude/rules/canvas.md:
 * «никаких аллокаций в кадре»). Без него функция чистая — каждый вызов создаёт
 * новый массив, как раньше. Вызывающий из кадрового цикла (game-play.ts) передаёт
 * свой персистентный буфер: существующие точки мутируются на месте, новые —
 * создаются один раз и переиспользуются в следующих кадрах.
 */
export function calculateAimPreviewDots(
    from: TCoords,
    angle: number,
    power: number,
    options?: Partial<TAimPreviewOptions>,
    out: TCoords[] = [],
): TCoords[] {
    const { minLength, lengthPerPower, dotSpacing } = options
        ? { ...AIM_PREVIEW_DEFAULTS, ...options }
        : AIM_PREVIEW_DEFAULTS;
    const length = minLength + power * lengthPerPower;
    const dotsCount = Math.floor(length / dotSpacing);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let i = 0; i < dotsCount; i++) {
        const distance = (i + 1) * dotSpacing;
        const x = from.x + distance * cos;
        const y = from.y + distance * sin;
        const dot = out[i];
        if (dot) {
            dot.x = x;
            dot.y = y;
        } else {
            out[i] = { x, y };
        }
    }
    out.length = dotsCount;
    return out;
}
