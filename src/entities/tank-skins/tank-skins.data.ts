import { classicGeometry } from './lib/geometry-classic';
import { heavyGeometry } from './lib/geometry-heavy';
import type { TTankGeometry, TTankPalette, TTankSkin, TTankSkinId } from './t-tank-skin';

/**
 * Палитры скинов (issue #481, образец — `docs/game-visuals/iteration-2/compare-svg.png`):
 * зелёный/красный/золотой — три цвета, читающиеся на боевом рельефе на 390px.
 * Косметика: ни одна роль здесь не влияет на HP/скорость/разброс (см. `tank-skin-parity.test.ts`).
 */
export const TANK_PALETTES: readonly TTankPalette[] = [
    {
        id: 'verdant',
        name: 'Изумруд',
        body: '#2fae3f',
        edge: '#14361a',
        track: '#1c2b1f',
        wheel: '#4a6b4f',
    },
    {
        id: 'crimson',
        name: 'Багрянец',
        body: '#c23b3b',
        edge: '#3a1010',
        track: '#2a1414',
        wheel: '#6b4a4a',
    },
    {
        id: 'amber',
        name: 'Янтарь',
        body: '#e0a72f',
        edge: '#3a2a10',
        track: '#2a2214',
        wheel: '#6b5a4a',
    },
];

/** Геометрии (силуэты) — набор растёт по мере арта; сейчас классика + тяжёлый (#481). */
export const TANK_GEOMETRIES: readonly TTankGeometry[] = [classicGeometry, heavyGeometry];

/** Реестр скинов — декартово произведение геометрий и палитр. */
export const TANK_SKINS: readonly TTankSkin[] = TANK_GEOMETRIES.flatMap((geometry) =>
    TANK_PALETTES.map((palette): TTankSkin => ({
        id: `${geometry.id}-${palette.id}`,
        geometry,
        palette,
    })),
);

/** Скин по умолчанию — ближайший к прежнему дефолтному виду игрока (зелёный). */
export const DEFAULT_TANK_SKIN_ID: TTankSkinId = 'classic-verdant';

const SKIN_BY_ID = new Map<TTankSkinId, TTankSkin>(TANK_SKINS.map((skin) => [skin.id, skin]));

/**
 * Скин по идентификатору — fail-closed на неизвестном id (как `pickSkyPresetById`):
 * битый/устаревший id из localStorage не должен тихо подставлять первый скин.
 */
export const getTankSkinById = (id: TTankSkinId): TTankSkin => {
    const skin = SKIN_BY_ID.get(id);
    if (!skin) {
        throw new Error(`Неизвестный скин танка: ${id}`);
    }
    return skin;
};

export const isTankSkinId = (value: string): value is TTankSkinId =>
    SKIN_BY_ID.has(value as TTankSkinId);
