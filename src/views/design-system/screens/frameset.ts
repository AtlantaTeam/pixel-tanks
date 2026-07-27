/** Порт `bp()`/`frameset()` из design-inventory.dc.html §11: превью экрана
 *  рендерится в РЕАЛЬНУЮ ширину брейкпоинта, а затем весь кадр ужимается
 *  `transform: scale()` до dispW×dispH, чтобы четыре среза встали рядом. */

/** Layout-вариант кадра. Реальный viewport при масштабировании не меняется, поэтому
 *  экраны переключают раскладку по этому пропу, а не по Tailwind-префиксам `md:`/`lg:`
 *  (те читали бы фактический размер окна, а не ширину кадра). */
export type TScreenVariant = 'mobile' | 'tablet' | 'desktop';

export type TScreenFrame = {
    w: number;
    h: number;
    scale: number;
    label: string;
    variant: TScreenVariant;
    dispW: number;
    dispH: number;
};

/** Высота кадра фиксирована на всех брейкпоинтах — инвентарь сравнивает срезы по ширине. */
export const SCREEN_FRAME_HEIGHT = 720;

export function bp(
    w: number,
    h: number,
    scale: number,
    label: string,
    variant: TScreenVariant,
): TScreenFrame {
    return {
        w,
        h,
        scale,
        label,
        variant,
        dispW: Math.round(w * scale),
        dispH: Math.round(h * scale),
    };
}

/** Четыре кадра каталога. Desktop-вариант переиспользуется на 1280 и 1920
 *  (в инвентаре — общий `deskV`): wide — тот же десктопный layout с max-width. */
export function frameset(): TScreenFrame[] {
    return [
        bp(390, SCREEN_FRAME_HEIGHT, 1, 'Mobile · 390', 'mobile'),
        bp(768, SCREEN_FRAME_HEIGHT, 0.62, 'Планшет · 768', 'tablet'),
        bp(1280, SCREEN_FRAME_HEIGHT, 0.42, 'Desktop · 1280', 'desktop'),
        bp(1920, SCREEN_FRAME_HEIGHT, 0.3, 'Wide · 1920', 'desktop'),
    ];
}
