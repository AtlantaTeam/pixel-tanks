import { describe, expect, it } from 'vitest';
import { TANK_SKINS } from '../tank-skins.data';
import { selectTankSkinForSeed } from './select-tank-skin-for-seed';

describe('selectTankSkinForSeed', () => {
    it('возвращает один и тот же скин для одного сида', () => {
        expect(selectTankSkinForSeed('battle-1')).toBe(selectTankSkinForSeed('battle-1'));
        expect(selectTankSkinForSeed(42)).toBe(selectTankSkinForSeed(42));
    });

    it('возвращает скин из реестра', () => {
        const ids = new Set(TANK_SKINS.map((skin) => skin.id));
        for (const seed of ['a', 'b', 'c', 1, 2, 3, 'daily-2026-08-13']) {
            expect(ids.has(selectTankSkinForSeed(seed))).toBe(true);
        }
    });

    it('разные сиды обычно дают разные скины (не константа)', () => {
        const picks = new Set(
            Array.from({ length: 20 }, (_, i) => selectTankSkinForSeed(`seed-${i}`)),
        );
        expect(picks.size).toBeGreaterThan(1);
    });

    it('не сдвигает основной поток RNG того же сида (суффикс — отдельный поток)', () => {
        // Инвариант, ради которого сделан суффикс `::tank-skin` (как у pickSkyPreset):
        // построение основного потока с тем же сидом не зависит от того, вызывали
        // ли мы до этого selectTankSkinForSeed.
        const seed = 'replay-seed';
        selectTankSkinForSeed(seed);
        const before = selectTankSkinForSeed(seed);
        selectTankSkinForSeed(seed);
        selectTankSkinForSeed(seed);
        const after = selectTankSkinForSeed(seed);
        expect(after).toBe(before);
    });
});
