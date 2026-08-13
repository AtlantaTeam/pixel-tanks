/**
 * Цвета Canvas-движка, зеркалящие --color-* токены игровой палитры (Pico-8)
 * из globals.css. Canvas не умеет резолвить CSS custom properties без
 * getComputedStyle на каждый кадр, поэтому значения продублированы здесь как
 * константы — единственное место в canvas-коде, где меняется hex.
 */
export const ENGINE_COLORS = {
    primary: '#ffc21f',
    accent: '#48ff00',
    // Индикатор «угол·сила» у ствола (issue #475): сила красится warning, а при
    // достижении максимума оттяжки индикатор и дуга краснеют — как чип оверлея.
    warning: '#ffa900',
    danger: '#ff4242',
} as const;
