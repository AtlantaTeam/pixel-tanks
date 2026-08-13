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
            const wheel = skin.geometry.buildWheelSvg(skin.palette);
            expect(hull).toContain('<svg');
            expect(hull).toContain(skin.palette.body);
            expect(barrel).toContain('<svg');
            expect(barrel).toContain(skin.palette.body);
            expect(wheel).toContain('<svg');
            expect(wheel).toContain(skin.palette.wheel);
            // Регрессия на грабли из issue: var() не резолвится ни в data:URL, ни на
            // канвасе — цвета обязаны быть подставлены литералом, не CSS custom property.
            expect(hull).not.toContain('var(');
            expect(barrel).not.toContain('var(');
            expect(wheel).not.toContain('var(');
        }
    });

    it('каждая геометрия описывает хотя бы один каток — доли внутри (0, 1] (issue #496)', () => {
        for (const geometry of TANK_GEOMETRIES) {
            expect(geometry.wheels.length).toBeGreaterThan(0);
            for (const wheel of geometry.wheels) {
                expect(wheel.cx).toBeGreaterThan(0);
                expect(wheel.cx).toBeLessThan(1);
                expect(wheel.cy).toBeGreaterThan(0);
                expect(wheel.cy).toBeLessThan(1);
                expect(wheel.r).toBeGreaterThan(0);
            }
        }
    });

    it('spec катков геометрии не пересекается с содержимым корпуса — hull больше не рисует круги катков', () => {
        // Регрессия на #496: если бы hull всё ещё рисовал катки сам, поверх них
        // накладывался бы вращающийся дубль (Tank.draw рисует оба слоя).
        for (const geometry of TANK_GEOMETRIES) {
            const hull = geometry.buildHullSvg(TANK_PALETTES[0]);
            expect(hull).not.toContain('circle');
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
