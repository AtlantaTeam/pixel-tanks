import { describe, expect, it } from 'vitest';
import { getTankSkinById, TANK_PALETTES, TANK_SKINS } from '../tank-skins.data';
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

    it('с исключением скина игрока держит цветовой контраст: палитра бота ≠ палитра игрока', () => {
        // Для КАЖДОЙ палитры игрока и набора сидов соперник обязан быть другой
        // палитры — иначе оба танка одного цвета и «свой/чужой» не читается.
        for (const palette of TANK_PALETTES) {
            const playerSkinId = `classic-${palette.id}` as const;
            for (const seed of ['a', 'b', 'c', 'd', 'e', 1, 2, 3, 42]) {
                const botSkinId = selectTankSkinForSeed(seed, playerSkinId);
                expect(getTankSkinById(botSkinId).palette.id).not.toBe(palette.id);
            }
        }
    });

    it('исключение детерминировано: тот же сид + тот же скин игрока → тот же соперник', () => {
        expect(selectTankSkinForSeed('battle-1', 'classic-verdant')).toBe(
            selectTankSkinForSeed('battle-1', 'classic-verdant'),
        );
    });

    it('без аргумента исключения пул — весь реестр (совместимость старой сигнатуры)', () => {
        const ids = new Set(TANK_SKINS.map((skin) => skin.id));
        for (const seed of ['a', 'b', 'c', 1, 2, 3]) {
            expect(ids.has(selectTankSkinForSeed(seed))).toBe(true);
        }
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
