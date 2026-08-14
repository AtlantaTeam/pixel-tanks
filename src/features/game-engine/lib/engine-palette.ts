/**
 * Цвета Canvas-движка, зеркалящие --color-* токены игровой палитры (Pico-8)
 * из globals.css. Canvas не умеет резолвить CSS custom properties без
 * getComputedStyle на каждый кадр, поэтому значения продублированы здесь как
 * константы — единственное место в canvas-коде, где меняется hex.
 */
export const ENGINE_COLORS = {
    primary: '#ffc21f',
    // Индикатор «угол·сила» у ствола и дуга предпросмотра (issue #475): обычное
    // состояние — accent, а на максимуме оттяжки индикатор и дуга краснеют в danger,
    // как чип оверлея (`drawAimPreview`).
    accent: '#48ff00',
    // Трасса прошлого выстрела бота (issue #543) и другая «вражеская» разметка
    // в canvas — зеркалит `--color-enemy` из globals.css.
    enemy: '#c900ff',
    danger: '#ff4242',
    // Тонировка земли ночью (#545, `GROUND_TINT`) — `--color-surface`: та же тёмная
    // подложка, что у панелей UI. Здесь, а не третьей копией hex в `scene-light.ts`.
    surface: '#101711',
    // Нейтральная линия земли демо-канваса витрины (issue #496, `TankWheelDemo`) —
    // `--color-border-strong`, не «просто хардкод»: та же граница, что у остальной UI-хромы.
    borderStrong: '#3f5a41',
} as const;
