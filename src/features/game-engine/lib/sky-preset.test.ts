import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { pickSkyPreset, pickSkyPresetById, SKY_PRESETS } from './sky-preset';

describe('SKY_PRESETS', () => {
    it('содержит ровно три пресета времени суток (день/закат/ночь)', () => {
        expect(SKY_PRESETS.map((preset) => preset.id)).toEqual(['day', 'sunset', 'night']);
    });

    it('у каждого пресета непустой градиент неба и цвета гор/облаков', () => {
        SKY_PRESETS.forEach((preset) => {
            expect(preset.sky.length).toBeGreaterThanOrEqual(2);
            preset.sky.forEach((stop) => {
                expect(stop.offset).toBeGreaterThanOrEqual(0);
                expect(stop.offset).toBeLessThanOrEqual(1);
                expect(stop.color).toMatch(/^#[0-9a-f]{6}$/i);
            });
            expect(preset.mountain).toMatch(/^#[0-9a-f]{6}$/i);
            expect(preset.cloud).toMatch(/^#[0-9a-f]{6}$/i);
            expect(preset.cloudAlpha).toBeGreaterThan(0);
            expect(preset.cloudAlpha).toBeLessThanOrEqual(1);
        });
    });
});

describe('pickSkyPreset', () => {
    it('один и тот же сид даёт тот же пресет', () => {
        [0, 1, 42, 'daily-2026-08-13', '777'].forEach((seed) => {
            expect(pickSkyPreset(seed).id).toBe(pickSkyPreset(seed).id);
        });
    });

    it('возвращает пресет из набора SKY_PRESETS', () => {
        for (let seed = 0; seed < 30; seed++) {
            expect(SKY_PRESETS).toContain(pickSkyPreset(seed));
        }
    });

    it('на разнообразии сидов встречаются все три пресета', () => {
        const ids = new Set<string>();
        for (let seed = 0; seed < 60; seed++) {
            ids.add(pickSkyPreset(seed).id);
        }
        expect(ids).toEqual(new Set(['day', 'sunset', 'night']));
    });

    it('не расходует основной поток RNG боя (namespaced seed)', () => {
        // Выбор пресета не должен трогать последовательность createSeededRandom(seed),
        // иначе рельеф/ветер того же боя сдвинулись бы (детерминизм реплея).
        const before = createSeededRandom(42)();
        pickSkyPreset(42);
        const after = createSeededRandom(42)();
        expect(after).toBe(before);
    });
});

describe('pickSkyPresetById', () => {
    it('возвращает пресет по идентификатору', () => {
        expect(pickSkyPresetById('sunset').id).toBe('sunset');
    });

    it('падает на неизвестном идентификаторе (fail-closed, а не тихий дефолт)', () => {
        // @ts-expect-error — проверяем защиту от неизвестного id в рантайме
        expect(() => pickSkyPresetById('storm')).toThrow();
    });
});
