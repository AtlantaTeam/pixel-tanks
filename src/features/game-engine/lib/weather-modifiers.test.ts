import { describe, expect, it } from 'vitest';
import { pickPrecipPreset, PRECIP_PRESETS, type TPrecipPresetId } from './precipitation';
import { MAX_WIND } from './wind';
import {
    applyWindModifier,
    NEUTRAL_WEATHER_MODIFIER,
    SNOW_WIND_MULTIPLIER,
    STORM_MIN_WIND_FRACTION,
    STORM_WIND_SHIFT_AFTER_SHOTS,
    stormShiftedWind,
    WEATHER_MODIFIERS,
    weatherModifierFor,
} from './weather-modifiers';

/**
 * Таблица «пресет → модификатор» (§7.8 разбора #534, критерий #547): значения
 * зафиксированы дословно, чтобы баланс погоды не разъехался молча. Правка любого
 * следствия обязана пройти через этот тест — это и есть барьер против тихого
 * дрейфа баланса.
 */
describe('WEATHER_MODIFIERS — таблица следствий погоды зафиксирована', () => {
    it('ясно — нейтральный модификатор (ни на что не влияет)', () => {
        expect(WEATHER_MODIFIERS.clear).toEqual({
            windMultiplier: 1,
            craterDarkenAlpha: 0,
            craterEdgeSoftenPx: 0,
            windShiftsMidBattle: false,
        });
    });

    it('снег — базовый ветер сильнее ровно на треть', () => {
        expect(WEATHER_MODIFIERS.snow).toEqual({
            windMultiplier: 4 / 3,
            craterDarkenAlpha: 0,
            craterEdgeSoftenPx: 0,
            windShiftsMidBattle: false,
        });
        expect(SNOW_WIND_MULTIPLIER).toBe(4 / 3);
    });

    it('дождь — кратеры темнее и край воронки на 1 px мягче', () => {
        expect(WEATHER_MODIFIERS.rain).toEqual({
            windMultiplier: 1,
            craterDarkenAlpha: 0.28,
            craterEdgeSoftenPx: 1,
            windShiftsMidBattle: false,
        });
    });

    it('буря — ветер меняется в середине боя, остального не трогает', () => {
        expect(WEATHER_MODIFIERS.sandstorm).toEqual({
            windMultiplier: 1,
            craterDarkenAlpha: 0,
            craterEdgeSoftenPx: 0,
            windShiftsMidBattle: true,
        });
    });

    it('у каждого пресета осадков есть строка в таблице', () => {
        for (const preset of PRECIP_PRESETS) {
            expect(WEATHER_MODIFIERS[preset.id]).toBeDefined();
        }
    });

    it('ровно один пресет усиливает ветер и ровно один меняет его в середине боя', () => {
        const ids = Object.keys(WEATHER_MODIFIERS) as TPrecipPresetId[];
        expect(ids.filter((id) => WEATHER_MODIFIERS[id].windMultiplier !== 1)).toEqual(['snow']);
        expect(ids.filter((id) => WEATHER_MODIFIERS[id].windShiftsMidBattle)).toEqual([
            'sandstorm',
        ]);
        expect(ids.filter((id) => WEATHER_MODIFIERS[id].craterDarkenAlpha > 0)).toEqual(['rain']);
    });
});

describe('weatherModifierFor', () => {
    it('возвращает модификатор пресета по id', () => {
        expect(weatherModifierFor('snow')).toBe(WEATHER_MODIFIERS.snow);
    });

    it('без пресета (сид не передан) — нейтральный модификатор', () => {
        expect(weatherModifierFor(undefined)).toBe(NEUTRAL_WEATHER_MODIFIER);
        expect(NEUTRAL_WEATHER_MODIFIER).toBe(WEATHER_MODIFIERS.clear);
    });
});

describe('applyWindModifier', () => {
    it('снег усиливает ветер на треть', () => {
        expect(applyWindModifier(0.006, WEATHER_MODIFIERS.snow)).toBeCloseTo(0.008, 10);
    });

    it('нейтральный модификатор не меняет ветер (домножение на 1)', () => {
        expect(applyWindModifier(0.006, WEATHER_MODIFIERS.clear)).toBe(0.006);
        expect(applyWindModifier(-0.004, NEUTRAL_WEATHER_MODIFIER)).toBe(-0.004);
    });

    it('знак ветра сохраняется (усиливается модуль, не направление)', () => {
        expect(applyWindModifier(-0.006, WEATHER_MODIFIERS.snow)).toBeLessThan(0);
    });
});

describe('stormShiftedWind — новый ветер бури детерминирован и заметен', () => {
    it('один сид и базовый ветер → одно и то же новое значение', () => {
        expect(stormShiftedWind(42, 0.005)).toBe(stormShiftedWind(42, 0.005));
        expect(stormShiftedWind('daily-2026-08-13', -0.003)).toBe(
            stormShiftedWind('daily-2026-08-13', -0.003),
        );
    });

    it('направление всегда переворачивается относительно базового', () => {
        // База вправо (+) → новый ветер влево (−), и наоборот.
        expect(stormShiftedWind(1, 0.006)).toBeLessThan(0);
        expect(stormShiftedWind(1, -0.006)).toBeGreaterThan(0);
    });

    it('магнитуда — не ниже половины шкалы и не выше максимума', () => {
        for (const seed of [1, 2, 3, 42, 999, 100000]) {
            const shifted = Math.abs(stormShiftedWind(seed, 0.006));
            expect(shifted).toBeGreaterThanOrEqual(MAX_WIND * STORM_MIN_WIND_FRACTION);
            expect(shifted).toBeLessThanOrEqual(MAX_WIND);
        }
    });

    it('разные сиды дают разную магнитуду смены (иначе смена предсказуема)', () => {
        const values = [1, 2, 3, 4, 5].map((seed) => stormShiftedWind(seed, 0.006));
        expect(new Set(values).size).toBeGreaterThan(1);
    });
});

describe('погода полностью выводится из сида (реплей воспроизводится побитово)', () => {
    it('повторное выведение из того же сида даёт тот же пресет и следствия', () => {
        for (const seed of ['daily-2026-08-13', 7, 42, 555]) {
            const presetA = pickPrecipPreset(seed);
            const presetB = pickPrecipPreset(seed);
            expect(presetA.id).toBe(presetB.id);
            expect(weatherModifierFor(presetA.id)).toBe(weatherModifierFor(presetB.id));
        }
    });

    it('порог смены ветра бури — фиксированное число выстрелов', () => {
        // Момент «середины боя» детерминирован номером выстрела, а не таймером/FPS —
        // иначе реплей разошёлся бы с живым боем.
        expect(STORM_WIND_SHIFT_AFTER_SHOTS).toBe(3);
        expect(Number.isInteger(STORM_WIND_SHIFT_AFTER_SHOTS)).toBe(true);
    });
});
