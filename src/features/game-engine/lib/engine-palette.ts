/**
 * Цвета Canvas-движка, зеркалящие --color-* токены игровой палитры (Pico-8)
 * из globals.css. Canvas не умеет резолвить CSS custom properties без
 * getComputedStyle на каждый кадр, поэтому значения продублированы здесь как
 * константы — единственное место в canvas-коде, где меняется hex.
 */
export const ENGINE_COLORS = {
    primary: '#ffcd75',
} as const;
