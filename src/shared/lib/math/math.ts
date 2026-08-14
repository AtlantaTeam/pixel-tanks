/**
 * Мелкая числовая математика, общая для слайсов: линейная интерполяция и кламп.
 * Живёт в `shared/lib`, чтобы каждый слайс не заводил свою копию `lerp`/`clamp` —
 * копии расползаются и молча расходятся (разные границы, разный знак).
 */

/** Линейная интерполяция: `a` при t=0, `b` при t=1. */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Зажимает `value` в отрезок `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
