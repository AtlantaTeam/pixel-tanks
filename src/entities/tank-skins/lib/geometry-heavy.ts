import type { TTankGeometry, TTankWheelSpec } from '../t-tank-skin';

/** viewBox корпуса — знаменатель долей `wheels` (issue #496). */
const HULL_VIEWBOX = { width: 200, height: 104 };
const WHEEL_CENTERS_X = [34, 60, 86, 112, 138, 164];
const WHEEL_CENTER_Y = 86;
const WHEEL_RADIUS = 7;

const wheels: readonly TTankWheelSpec[] = WHEEL_CENTERS_X.map((cx) => ({
    cx: cx / HULL_VIEWBOX.width,
    cy: WHEEL_CENTER_Y / HULL_VIEWBOX.height,
    r: WHEEL_RADIUS / HULL_VIEWBOX.width,
}));

/**
 * Геометрия «тяжёлого» танка — из прототипа `docs/game-visuals/svg-proto/hull-heavy.svg`
 * и `barrel.svg` (ступенчатый корпус, башня). Отличается силуэтом от `classic`
 * (issue #481: «различаются формой, а не только цветом»), не только палитрой.
 * Цвета — литеральной подстановкой в строку, НЕ через `var()`: ни `librsvg`, ни
 * канвас (`data:URL` → `Image` → `drawImage`) кастомные CSS-свойства не резолвят —
 * см. докблок `lib/tank-skin-image-cache.ts`. Катки со спицами (issue #496) были
 * статичной разметкой прямо в корпусе — перенесены в отдельный вращающийся спрайт
 * (`buildWheelSvg` + `wheels`), иначе поверх них накладывался бы вращающийся дубль.
 */
export const heavyGeometry: TTankGeometry = {
    id: 'heavy',
    name: 'Тяжёлый',
    wheels,
    buildHullSvg: (
        palette,
    ) => `<svg width="200" height="104" viewBox="0 0 200 104" xmlns="http://www.w3.org/2000/svg">
    <g fill="${palette.body}" stroke="${palette.edge}" stroke-width="3" stroke-linejoin="round">
        <path d="M12 56 h20 v-10 h30 v-8 h56 v8 h30 v10 h20 v18 h-8 v6 H20 v-6 h-8 z"/>
        <path d="M74 38 h12 v-10 h28 v10 h12 v10 H74 z"/>
        <rect x="16" y="70" width="168" height="8"/>
    </g>
    <g fill="${palette.track}" stroke="${palette.edge}" stroke-width="3">
        <rect x="14" y="78" width="172" height="16" rx="8"/>
    </g>
</svg>`,
    buildBarrelSvg: (
        palette,
    ) => `<svg width="90" height="18" viewBox="0 0 90 18" xmlns="http://www.w3.org/2000/svg">
    <g fill="${palette.body}" stroke="${palette.edge}" stroke-width="3" stroke-linejoin="round">
        <rect x="2" y="4" width="14" height="10" rx="2"/>
        <rect x="16" y="6" width="58" height="6"/>
        <rect x="74" y="3" width="12" height="12" rx="2"/>
    </g>
</svg>`,
    // Тот же крест-спицы, что был статичной разметкой в корпусе, — теперь на
    // спрайте катка, который умеет вращаться (issue #496).
    buildWheelSvg: (
        palette,
    ) => `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="6" fill="${palette.wheel}" stroke="${palette.edge}" stroke-width="2"/>
    <path d="M7 1 v12 M1 7 h12" stroke="${palette.edge}" stroke-width="2"/>
</svg>`,
};
