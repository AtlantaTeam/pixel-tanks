import { describe, expect, it } from 'vitest';
import { BASE_SAND_RGB, deltaE } from './scene-light';
import {
    averageParticleAlpha,
    buildPrecipField,
    CENTRAL_MAX,
    CENTRAL_MIN,
    PRECIP_COUNT_MAX,
    PRECIP_DIM_SCALE,
    PRECIP_PRESETS,
    pickPrecipPreset,
    pickPrecipPresetById,
    precipAlphaScale,
    precipCount,
    precipGroundTint,
    precipTintedSand,
    precipWindNorm,
    type TPrecipPresetId,
} from './precipitation';

/** Пресет с частицами для тестов поля (не `clear`). */
const RAIN = pickPrecipPresetById('rain');

describe('pickPrecipPreset', () => {
    it('детерминирован: один сид — один пресет', () => {
        for (const seed of [1, 42, 'daily-2026-08-13', 777]) {
            expect(pickPrecipPreset(seed).id).toBe(pickPrecipPreset(seed).id);
        }
    });

    it('clear выпадает примерно в 60% боёв', () => {
        let clear = 0;
        const total = 2000;
        for (let seed = 0; seed < total; seed++) {
            if (pickPrecipPreset(seed).id === 'clear') clear += 1;
        }
        const share = clear / total;
        expect(share).toBeGreaterThan(0.5);
        expect(share).toBeLessThan(0.7);
    });

    it('все три вида осадков встречаются на разных сидах', () => {
        const seen = new Set<TPrecipPresetId>();
        for (let seed = 0; seed < 2000; seed++) {
            seen.add(pickPrecipPreset(seed).id);
        }
        expect(seen.has('rain')).toBe(true);
        expect(seen.has('snow')).toBe(true);
        expect(seen.has('sandstorm')).toBe(true);
    });
});

describe('pickPrecipPresetById', () => {
    it('возвращает пресет по id', () => {
        expect(pickPrecipPresetById('snow').id).toBe('snow');
    });

    it('бросает на неизвестном id (fail-closed)', () => {
        // @ts-expect-error проверяем защиту от невалидного id в рантайме
        expect(() => pickPrecipPresetById('storm')).toThrow();
    });
});

describe('precipCount', () => {
    it('clear не даёт частиц', () => {
        expect(precipCount(1280, pickPrecipPresetById('clear'))).toBe(0);
    });

    it('плотнее на широком экране, но с потолком (FPS)', () => {
        expect(precipCount(390, RAIN)).toBeLessThan(precipCount(1280, RAIN));
        expect(precipCount(4000, RAIN)).toBe(PRECIP_COUNT_MAX);
    });

    it('вырожденная ширина не роняет и не даёт частиц', () => {
        expect(precipCount(0, RAIN)).toBe(0);
        expect(precipCount(-10, RAIN)).toBe(0);
        expect(precipCount(Number.NaN, RAIN)).toBe(0);
    });
});

describe('buildPrecipField', () => {
    it('clear — пустое поле', () => {
        expect(buildPrecipField(1, 1280, pickPrecipPresetById('clear'))).toEqual([]);
    });

    it('детерминирован от сида', () => {
        expect(buildPrecipField(7, 1280, RAIN)).toEqual(buildPrecipField(7, 1280, RAIN));
    });

    it('разные сиды дают разные поля', () => {
        expect(buildPrecipField(1, 1280, RAIN)).not.toEqual(buildPrecipField(2, 1280, RAIN));
    });

    it('плотность в центральной трети измеримо ниже, чем по краям (правило 1)', () => {
        const field = buildPrecipField(3, 1280, RAIN);
        const central = field.filter((p) => p.xFrac >= CENTRAL_MIN && p.xFrac < CENTRAL_MAX).length;
        const edge = field.length - central;
        // Нормируем на ширину области: центр занимает ⅓, края — ⅔.
        const centralPerWidth = central / (CENTRAL_MAX - CENTRAL_MIN);
        const edgePerWidth = edge / (1 - (CENTRAL_MAX - CENTRAL_MIN));
        expect(centralPerWidth).toBeLessThan(edgePerWidth * 0.75);
    });

    it('дальний план плотнее ближнего (правило 1)', () => {
        const field = buildPrecipField(5, 1280, RAIN);
        const far = field.filter((p) => p.depth === 'far').length;
        expect(far).toBeGreaterThan(field.length / 2);
    });

    it('все частицы в пределах кадра', () => {
        const field = buildPrecipField(9, 1280, RAIN);
        for (const p of field) {
            expect(p.xFrac).toBeGreaterThanOrEqual(0);
            expect(p.xFrac).toBeLessThan(1);
            expect(p.yFrac).toBeGreaterThanOrEqual(0);
            expect(p.yFrac).toBeLessThan(1);
        }
    });
});

describe('гашение на прицеливании (правило 2)', () => {
    it('precipAlphaScale падает при активной оттяжке', () => {
        expect(precipAlphaScale(false)).toBe(1);
        expect(precipAlphaScale(true)).toBe(PRECIP_DIM_SCALE);
        expect(PRECIP_DIM_SCALE).toBeLessThan(0.5);
    });

    it('средняя альфа частиц падает при активной оттяжке', () => {
        const field = buildPrecipField(11, 1280, RAIN);
        const bright = averageParticleAlpha(field, false);
        const dim = averageParticleAlpha(field, true);
        expect(dim).toBeLessThan(bright);
        expect(dim / bright).toBeCloseTo(PRECIP_DIM_SCALE, 5);
    });

    it('пустое поле — нулевая средняя альфа, без деления на ноль', () => {
        expect(averageParticleAlpha([], false)).toBe(0);
    });
});

describe('precipWindNorm', () => {
    it('нормирует ветер в [-1, 1] со знаком', () => {
        expect(precipWindNorm(0)).toBe(0);
        expect(precipWindNorm(0.01)).toBeCloseTo(1, 5);
        expect(precipWindNorm(-0.01)).toBeCloseTo(-1, 5);
        expect(precipWindNorm(0.02)).toBe(1);
        expect(precipWindNorm(-0.02)).toBe(-1);
    });

    it('нечисловой ветер — штиль', () => {
        expect(precipWindNorm(Number.NaN)).toBe(0);
        expect(precipWindNorm(Number.POSITIVE_INFINITY)).toBe(0);
    });
});

describe('reduced-motion: погода по цвету рельефа (правило 3)', () => {
    it('без reduced-motion тонировки рельефа нет (погоду несут частицы)', () => {
        expect(precipGroundTint(RAIN, false)).toEqual([]);
    });

    it('clear/undefined — без тонировки даже при reduced-motion', () => {
        expect(precipGroundTint(pickPrecipPresetById('clear'), true)).toEqual([]);
        expect(precipGroundTint(undefined, true)).toEqual([]);
    });

    it('каждый осадочный пресет заметно меняет цвет песка (ΔE от чистого)', () => {
        for (const id of ['rain', 'snow', 'sandstorm'] as const) {
            const tinted = precipTintedSand(BASE_SAND_RGB, pickPrecipPresetById(id));
            expect(deltaE(tinted, BASE_SAND_RGB)).toBeGreaterThan(3);
        }
    });

    it('пресеты различимы между собой по цвету рельефа', () => {
        const rain = precipTintedSand(BASE_SAND_RGB, pickPrecipPresetById('rain'));
        const snow = precipTintedSand(BASE_SAND_RGB, pickPrecipPresetById('snow'));
        const storm = precipTintedSand(BASE_SAND_RGB, pickPrecipPresetById('sandstorm'));
        expect(deltaE(rain, snow)).toBeGreaterThan(5);
        expect(deltaE(rain, storm)).toBeGreaterThan(5);
        expect(deltaE(snow, storm)).toBeGreaterThan(5);
    });
});

describe('PRECIP_PRESETS', () => {
    it('ровно один clear и три вида осадков', () => {
        expect(PRECIP_PRESETS.map((p) => p.id).sort()).toEqual([
            'clear',
            'rain',
            'sandstorm',
            'snow',
        ]);
    });

    it('только у clear нет формы частицы', () => {
        for (const preset of PRECIP_PRESETS) {
            expect(preset.shape === null).toBe(preset.id === 'clear');
        }
    });
});
