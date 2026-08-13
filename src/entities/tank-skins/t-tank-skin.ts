/**
 * Идентификатор геометрии (силуэта) корпуса+ствола. `classic` — форма дефолтного
 * танка (старые `left-tank.svg`/`gunpoint.svg`, перенесённая в шаблон), `heavy` —
 * силуэт из прототипа `docs/game-visuals/svg-proto/hull-heavy.svg`.
 */
export type TTankGeometryId = 'classic' | 'heavy';

/** Идентификатор цветовой палитры скина. */
export type TTankPaletteId = 'verdant' | 'crimson' | 'amber';

/** Идентификатор скина — пара геометрия+палитра, ключ реестра и кэша отрисовки. */
export type TTankSkinId = `${TTankGeometryId}-${TTankPaletteId}`;

/**
 * Цвета скина. Ровно эти четыре роли используют геометрии (см. `lib/geometry-*`):
 * `body` — корпус/башня, `edge` — обводка, `track` — гусеница, `wheel` — катки.
 * Раскраска подставляется в SVG-строку до создания `Image` (`var()` не резолвится
 * ни в data:URL-изображении, ни на канвасе — см. докблок `lib/tank-skin-image-cache.ts`).
 */
export type TTankPalette = {
    id: TTankPaletteId;
    /** Человекочитаемое имя — витрина `/design-system` и пикер настроек. */
    name: string;
    body: string;
    edge: string;
    track: string;
    wheel: string;
};

/**
 * Каток — центр и радиус как доля ширины/высоты корпуса (0..1), НЕ пиксели
 * исходного SVG (issue #496): корпус растягивается в `bodyRect()` под текущий
 * `scale`/аспект канвы, а доля не зависит от того, во что его фактически
 * растянули. Ровно эти координаты читает `Tank.draw`, чтобы поставить каток
 * поверх корпуса и повернуть вокруг его собственного центра.
 */
export type TTankWheelSpec = { cx: number; cy: number; r: number };

/**
 * Геометрия — чистые функции, собирающие разметку SVG корпуса и ствола под
 * переданную палитру. Ствол — отдельный спрайт (issue #481): вращается вокруг
 * точки крепления независимо от корпуса, поэтому у него своя разметка и свой
 * viewBox. Катки (issue #496) — тоже отдельный спрайт: `buildHullSvg` их НЕ
 * рисует (иначе поверх статичного катка в корпусе накладывался бы вращающийся
 * дубль), `wheels` даёт их положение/радиус, `buildWheelSvg` — общий на все
 * катки геометрии спрайт со спицами (без них вращение не видно — плоский круг
 * неотличим от неподвижного).
 */
export type TTankGeometry = {
    id: TTankGeometryId;
    name: string;
    wheels: readonly TTankWheelSpec[];
    buildHullSvg: (palette: TTankPalette) => string;
    buildBarrelSvg: (palette: TTankPalette) => string;
    buildWheelSvg: (palette: TTankPalette) => string;
};

/** Скин — пара геометрия+палитра, только косметика (никаких боевых параметров). */
export type TTankSkin = {
    id: TTankSkinId;
    geometry: TTankGeometry;
    palette: TTankPalette;
};
