import type { TTankGeometry } from '../t-tank-skin';

/**
 * Геометрия «тяжёлого» танка — из прототипа `docs/game-visuals/svg-proto/hull-heavy.svg`
 * и `barrel.svg` (ступенчатый корпус, башня, катки со спицами). Отличается силуэтом
 * от `classic` (issue #481: «различаются формой, а не только цветом»), не только
 * палитрой. Цвета — литеральной подстановкой в строку, НЕ через `var()`: ни
 * `librsvg`, ни канвас (`data:URL` → `Image` → `drawImage`) кастомные CSS-свойства
 * не резолвят — см. докблок `lib/tank-skin-image-cache.ts`.
 */
export const heavyGeometry: TTankGeometry = {
    id: 'heavy',
    name: 'Тяжёлый',
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
    <g fill="${palette.wheel}" stroke="${palette.edge}" stroke-width="2">
        <circle cx="34" cy="86" r="7"/>
        <circle cx="60" cy="86" r="7"/>
        <circle cx="86" cy="86" r="7"/>
        <circle cx="112" cy="86" r="7"/>
        <circle cx="138" cy="86" r="7"/>
        <circle cx="164" cy="86" r="7"/>
    </g>
    <g stroke="${palette.edge}" stroke-width="2">
        <path d="M34 80 v12 M28 86 h12"/>
        <path d="M60 80 v12 M54 86 h12"/>
        <path d="M86 80 v12 M80 86 h12"/>
        <path d="M112 80 v12 M106 86 h12"/>
        <path d="M138 80 v12 M132 86 h12"/>
        <path d="M164 80 v12 M158 86 h12"/>
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
};
