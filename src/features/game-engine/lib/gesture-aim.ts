import type { TCoords } from '@/shared/model';
import { calculateDragAim, DRAG_AIM_DEFAULTS, type TDragAimOptions } from './drag-aim';

/**
 * Визуал жеста «оттяни-отпусти» (handoff, раздел «Прицеливание `aim`»): чистый
 * расчёт всего, что рисует оверлей и движок. Рендер (SVG-оверлей + короткий
 * сегмент на канвасе) отделён от этих функций — правило `.claude/rules/canvas.md`:
 * физика и геометрия считаются здесь, детерминированно, а `ui/` только рисует.
 */

export type TGestureAim = {
    angle: number;
    power: number;
    /**
     * Оттяжка достигла максимума силы (сработал клэмп `powerMax`) — луч и чип
     * краснеют, чип показывает «МАКС», сила зафиксирована на `powerMax`.
     */
    isMax: boolean;
};

/**
 * Как `calculateDragAim`, но дополнительно сообщает, упёрлась ли сила в максимум.
 * `calculateDragAim` молча клэмпит силу к `powerMax`, скрывая факт превышения —
 * а именно по нему оверлей переключается в состояние «МАКС».
 */
export function calculateGestureAim(
    start: TCoords,
    current: TCoords,
    options: Partial<TDragAimOptions> = {},
): TGestureAim | null {
    const aim = calculateDragAim(start, current, options);
    if (!aim) return null;
    const powerMax = options.powerMax ?? DRAG_AIM_DEFAULTS.powerMax;
    return { angle: aim.angle, power: aim.power, isMax: aim.power >= powerMax };
}

// Короткий сегмент направления удалён (issue #475): его заменила дуга предпросмотра
// траектории — считается тем же кодом, что и полёт (`fillTrajectoryPreview`), и рисуется
// движком (`GamePlay.drawAimPreview`). Расчёт луча оттяжки/чипа остаётся здесь.

/** Прямоугольная зона жеста (клиентские или локальные координаты — важна лишь пара). */
export type TGestureZone = { top: number; bottom: number; left: number; right: number };

/**
 * Зона имеет положительную площадь? На коротких landscape-вьюпортах фиксированные
 * отступы верхнего оверлея и палубы могут перекрыться (top ≥ bottom) — тогда зоны
 * фактически нет. Гейт старта в этом случае обязан быть fail-open (жест разрешён
 * везде), иначе игрок не сможет целиться вовсе. Проверяется перед гейтом старта.
 */
export function isValidGestureZone(zone: TGestureZone): boolean {
    return zone.bottom > zone.top && zone.right > zone.left;
}

/**
 * Точка внутри зоны жеста? Оттяжку можно начинать только внутри зоны — старт на
 * элементах HUD (за границами зоны) прицеливание не начинает (handoff, «зона жеста»).
 */
export function isPointInGestureZone(point: TCoords, zone: TGestureZone): boolean {
    return (
        point.x >= zone.left &&
        point.x <= zone.right &&
        point.y >= zone.top &&
        point.y <= zone.bottom
    );
}

// Чип предпросмотра «угол · сила» удалён (issue #565): его числа уже дублировали
// верхнюю панель и подпись у ствола (`game-play.drawBarrelReadout`), а на мобиле в
// момент полной оттяжки чип ложился прямо на танк — окклюзия по построению, не
// «неудачные числа». Вместе с чипом ушли клэмпы `clampChipTop`/`clampChipCenterX`.

/**
 * Точка привязки чат-бабла бота (нижний край, растёт вверх — handoff «Чат-бабл
 * бота»): не должна уходить выше верхней границы зоны жеста, иначе бабл заходит
 * в полосы верхнего HUD (handoff «Чат-бабл... не заходит в полосы HUD»). `zone.top`
 * совпадает с нижней границей верхнего оверлея на любом брейкпоинте (та же зона,
 * что и у жеста/чипа), поэтому отдельного порога под бабл считать не нужно.
 */
export function clampBubbleAnchorY(rawY: number, zone: TGestureZone, bubbleHeight: number): number {
    return Math.max(rawY, zone.top + bubbleHeight);
}
