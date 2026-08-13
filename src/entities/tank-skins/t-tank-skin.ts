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
 * Геометрия — чистые функции, собирающие разметку SVG корпуса и ствола под
 * переданную палитру. Ствол — отдельный спрайт (issue #481): вращается вокруг
 * точки крепления независимо от корпуса, поэтому у него своя разметка и свой
 * viewBox.
 */
export type TTankGeometry = {
    id: TTankGeometryId;
    name: string;
    buildHullSvg: (palette: TTankPalette) => string;
    buildBarrelSvg: (palette: TTankPalette) => string;
};

/** Скин — пара геометрия+палитра, только косметика (никаких боевых параметров). */
export type TTankSkin = {
    id: TTankSkinId;
    geometry: TTankGeometry;
    palette: TTankPalette;
};
