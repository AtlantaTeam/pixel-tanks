import { createSeededRandom } from '@/shared/lib/random';
import { TANK_SKINS } from '../tank-skins.data';
import type { TTankSkinId } from '../t-tank-skin';

/**
 * Детерминированно выбирает скин соперника по сиду боя (issue #481, GDD:
 * «Скин соперника выбирается детерминированно от сида, чтобы реплей выглядел
 * так же»). Сид домешивается суффиксом `::tank-skin` в отдельный поток RNG —
 * как `pickSkyPreset` (`::sky`), чтобы не сдвигать основную последовательность
 * (рельеф/ветер/бот) и не разойтись с уже записанными реплеями.
 */
export const selectTankSkinForSeed = (seed: number | string): TTankSkinId => {
    const random = createSeededRandom(`${seed}::tank-skin`);
    const index = Math.floor(random() * TANK_SKINS.length);
    // Клэмп на случай теоретического random() === 1 у чужой реализации RNG.
    return TANK_SKINS[Math.min(index, TANK_SKINS.length - 1)].id;
};
