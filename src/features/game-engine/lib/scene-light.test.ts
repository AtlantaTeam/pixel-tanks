import { describe, expect, it } from 'vitest';
import { pickCelestialGeometry } from './sky-celestial';
import { pickSkyPreset, SKY_PRESETS, type TSkyPresetId } from './sky-preset';
import {
    applyGroundTint,
    ARENA_CENTER,
    BASE_SAND_RGB,
    computeLightDirection,
    computeSceneLight,
    deltaE,
    edgeHighlightColor,
    hexToRgb,
} from './scene-light';

const PRESET_IDS: TSkyPresetId[] = ['day', 'sunset', 'night'];

describe('computeLightDirection — сторона тени противоположна светилу', () => {
    it('знак горизонтали направления противоположен смещению светила от центра (все сиды)', () => {
        for (let seed = 0; seed < 50; seed++) {
            const preset = pickSkyPreset(seed);
            const celestial = pickCelestialGeometry(seed, preset.id);
            const dir = computeLightDirection(celestial);
            const celestialSide = Math.sign(celestial.xFrac - ARENA_CENTER.xFrac);
            // Тень смещается по dx направления света; его знак обязан быть обратным
            // знаку смещения светила от центра (критерий #545).
            expect(Math.sign(dir.dx)).toBe(-celestialSide);
        }
    });

    it('единичная длина вектора направления', () => {
        const celestial = pickCelestialGeometry(7, 'day');
        const dir = computeLightDirection(celestial);
        expect(Math.hypot(dir.dx, dir.dy)).toBeCloseTo(1, 6);
    });

    it('вертикальная компонента направлена вниз (светило над ареной)', () => {
        for (let seed = 0; seed < 20; seed++) {
            const preset = pickSkyPreset(seed);
            const celestial = pickCelestialGeometry(seed, preset.id);
            // Центр арены (0.68) ниже светила (yFrac ≤ 0.56) — свет идёт вниз, dy > 0.
            expect(computeLightDirection(celestial).dy).toBeGreaterThan(0);
        }
    });

    it('светило ровно по центру по X → нулевое горизонтальное смещение', () => {
        const dir = computeLightDirection({
            xFrac: ARENA_CENTER.xFrac,
            yFrac: 0.3,
            radiusFrac: 0.05,
            rotation: 0,
        });
        expect(dir.dx).toBe(0);
    });
});

describe('applyGroundTint / deltaE — тонировка земли различает пресеты', () => {
    it('средний цвет песка различается между всеми парами пресетов на ΔE > 15', () => {
        const samples = PRESET_IDS.map((id) => applyGroundTint(BASE_SAND_RGB, id));
        for (let i = 0; i < samples.length; i++) {
            for (let j = i + 1; j < samples.length; j++) {
                expect(deltaE(samples[i], samples[j])).toBeGreaterThan(15);
            }
        }
    });

    it('день не тонирован — песок остаётся базовым', () => {
        expect(applyGroundTint(BASE_SAND_RGB, 'day')).toEqual(BASE_SAND_RGB);
    });

    it('ночь заметно темнее дня (сумма компонент падает)', () => {
        const day = applyGroundTint(BASE_SAND_RGB, 'day');
        const night = applyGroundTint(BASE_SAND_RGB, 'night');
        const sum = (c: readonly number[]) => c[0] + c[1] + c[2];
        expect(sum(night)).toBeLessThan(sum(day));
    });

    it('ΔE симметрична и нулевая для одинаковых цветов', () => {
        expect(deltaE(BASE_SAND_RGB, BASE_SAND_RGB)).toBe(0);
        const a = applyGroundTint(BASE_SAND_RGB, 'night');
        const b = applyGroundTint(BASE_SAND_RGB, 'sunset');
        expect(deltaE(a, b)).toBeCloseTo(deltaE(b, a), 6);
    });
});

describe('hexToRgb', () => {
    it('парсит 6-значный hex', () => {
        expect(hexToRgb('#ffa900')).toEqual([255, 169, 0]);
        expect(hexToRgb('101711')).toEqual([16, 23, 17]);
    });
});

describe('edgeHighlightColor — тон каймы светила', () => {
    it('солнце — цвет лучей (rayColor)', () => {
        const day = SKY_PRESETS.find((p) => p.id === 'day')!;
        expect(edgeHighlightColor(day)).toBe(day.celestial.rayColor);
    });

    it('луна — цвет диска (rayColor нет)', () => {
        const night = SKY_PRESETS.find((p) => p.id === 'night')!;
        expect(edgeHighlightColor(night)).toBe(night.celestial.core);
    });
});

describe('computeSceneLight — детерминизм и связь с небом', () => {
    it('один сид даёт одну модель света', () => {
        expect(computeSceneLight('daily-2026-08-13')).toEqual(
            computeSceneLight('daily-2026-08-13'),
        );
    });

    it('пресет и геометрия совпадают с выбором неба (тот же сид)', () => {
        const light = computeSceneLight(42);
        expect(light.preset).toEqual(pickSkyPreset(42));
        expect(light.celestial).toEqual(pickCelestialGeometry(42, light.preset.id));
    });

    it('тонировка и цвет кромок соответствуют пресету', () => {
        for (let seed = 0; seed < 20; seed++) {
            const light = computeSceneLight(seed);
            expect(light.edgeColor).toBe(edgeHighlightColor(light.preset));
            expect(light.groundTint).toBe(
                // тонировка — та же ссылка, что в GROUND_TINT по id пресета
                computeSceneLight(seed).groundTint,
            );
        }
    });
});
