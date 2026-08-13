import type { TTankGeometry, TTankWheelSpec } from '../t-tank-skin';

/** viewBox корпуса — знаменатель долей `wheels` (issue #496). */
const HULL_VIEWBOX = { width: 200, height: 93 };
const WHEEL_CENTERS_X = [30, 58, 86, 114, 142, 170];
const WHEEL_CENTER_Y = 76;
const WHEEL_RADIUS = 10;

const wheels: readonly TTankWheelSpec[] = WHEEL_CENTERS_X.map((cx) => ({
    cx: cx / HULL_VIEWBOX.width,
    cy: WHEEL_CENTER_Y / HULL_VIEWBOX.height,
    r: WHEEL_RADIUS / HULL_VIEWBOX.width,
}));

/**
 * Геометрия дефолтного танка (была `public/game/left-tank.svg`/`gunpoint.svg`),
 * перенесённая в шаблон под подстановку палитры (issue #481). Раскладка ролей:
 * гусеничная полоса — `track`, катки — `wheel`, башня — `body`, обводка — `edge`.
 * Катки (issue #496) в `buildHullSvg` больше не рисуются — они отдельный
 * вращающийся спрайт (`buildWheelSvg` + `wheels`), см. докблок `TTankGeometry`.
 */
export const classicGeometry: TTankGeometry = {
    id: 'classic',
    name: 'Классика',
    wheels,
    // Прежние доли превью классики (ствол выходит из башни чуть выше центра).
    barrelMount: { top: 0.2, left: 0.36, width: 0.58 },
    buildHullSvg: (
        palette,
    ) => `<svg width="200" height="93" viewBox="0 0 200 93" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 48C2 46.3431 3.34315 45 5 45H195C196.657 45 198 46.3431 198 48V63C198 78.464 185.464 91 170 91H30C14.536 91 2 78.464 2 63V48Z" stroke="${palette.edge}" stroke-width="4"/>
    <rect x="4" y="46" width="192" height="16" fill="${palette.track}"/>
    <path d="M83.5692 54.766C82.8647 54.9202 82.1353 54.9202 81.4308 54.766L37.5284 45.1558C36.0551 44.8333 34.806 43.863 34.1292 42.5152L25.6453 25.6195C24.4521 23.2432 25.3275 20.3486 27.6377 19.0319L55.099 3.37944C55.8533 2.94947 56.7066 2.72336 57.5749 2.72336H107.425C108.293 2.72336 109.147 2.94947 109.901 3.37944L137.362 19.0319C139.672 20.3486 140.548 23.2432 139.355 25.6195L130.871 42.5152C130.194 43.863 128.945 44.8333 127.472 45.1558L83.5692 54.766Z" fill="${palette.body}"/>
</svg>`,
    buildBarrelSvg: (
        palette,
    ) => `<svg width="200" height="40" viewBox="0 0 200 40" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="10" width="200" height="20" fill="${palette.body}" stroke="${palette.edge}" stroke-width="2"/>
    <rect x="150" y="0" width="50" height="40" fill="${palette.edge}"/>
</svg>`,
    // Спицы через центр (issue #496): без них вращение круга неотличимо от покоя.
    buildWheelSvg: (
        palette,
    ) => `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="9" fill="${palette.wheel}" stroke="${palette.edge}" stroke-width="2"/>
    <path d="M10 2 v16 M2 10 h16" stroke="${palette.edge}" stroke-width="2"/>
</svg>`,
};
