import { describe, expect, it } from 'vitest';
import {
    DEFAULT_TANK_SKIN_ID,
    getTankSkinById,
    isTankSkinId,
    TANK_GEOMETRIES,
    TANK_PALETTES,
    TANK_SKINS,
} from './tank-skins.data';

describe('реестр скинов танков', () => {
    it('скин — декартово произведение геометрий и палитр, все id уникальны', () => {
        expect(TANK_SKINS).toHaveLength(TANK_GEOMETRIES.length * TANK_PALETTES.length);
        expect(new Set(TANK_SKINS.map((skin) => skin.id)).size).toBe(TANK_SKINS.length);
    });

    it('скин по умолчанию присутствует в реестре', () => {
        expect(isTankSkinId(DEFAULT_TANK_SKIN_ID)).toBe(true);
        expect(getTankSkinById(DEFAULT_TANK_SKIN_ID).id).toBe(DEFAULT_TANK_SKIN_ID);
    });

    it('getTankSkinById падает fail-closed на неизвестном id', () => {
        // @ts-expect-error — намеренно битый id (как из устаревшего localStorage)
        expect(() => getTankSkinById('unknown-skin')).toThrow(/Неизвестный скин/);
    });

    it('каждая геометрия рисует непустой SVG для каждой палитры (хотя бы одну ссылку на цвет)', () => {
        for (const skin of TANK_SKINS) {
            const hull = skin.geometry.buildHullSvg(skin.palette);
            const barrel = skin.geometry.buildBarrelSvg(skin.palette);
            expect(hull).toContain('<svg');
            expect(hull).toContain(skin.palette.body);
            expect(barrel).toContain('<svg');
            expect(barrel).toContain(skin.palette.body);
            // Регрессия на грабли из issue: var() не резолвится ни в data:URL, ни на
            // канвасе — цвета обязаны быть подставлены литералом, не CSS custom property.
            expect(hull).not.toContain('var(');
            expect(barrel).not.toContain('var(');
        }
    });

    it('разные геометрии одного скина различаются формой (не совпадающая разметка)', () => {
        const [classicSkin] = TANK_SKINS.filter((skin) => skin.geometry.id === 'classic');
        const [heavySkin] = TANK_SKINS.filter((skin) => skin.geometry.id === 'heavy');
        expect(classicSkin.geometry.buildHullSvg(classicSkin.palette)).not.toBe(
            heavySkin.geometry.buildHullSvg(heavySkin.palette),
        );
    });
});
