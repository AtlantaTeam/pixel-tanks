import { createSeededRandom } from '@/shared/lib/random';
import { getTankSkinById, TANK_SKINS } from '../tank-skins.data';
import type { TTankSkinId } from '../t-tank-skin';

/**
 * Детерминированно выбирает скин соперника по сиду боя (issue #481, GDD:
 * «Скин соперника выбирается детерминированно от сида, чтобы реплей выглядел
 * так же»). Сид домешивается суффиксом `::tank-skin` в отдельный поток RNG —
 * как `pickSkyPreset` (`::sky`), чтобы не сдвигать основную последовательность
 * (рельеф/ветер/бот) и не разойтись с уже записанными реплеями.
 *
 * `excludePlayerSkinId` — скин игрока: соперник выбирается из палитр, ОТЛИЧНЫХ
 * от палитры игрока, чтобы всегда держался цветовой контраст «свой/чужой»
 * (старый код гарантировал его жёстко: игрок зелёный, бот тёмно-красный; GDD
 * особо подчёркивает читаемость боя). Силуэт совпасть может — его различают
 * позиция и направление ствола, — а цвет нет. Пул отбирается по `палитре`, не по
 * `id`: исключить один скин мало (в 1 бою из 6 бот брал бы ту же палитру другой
 * геометрии и всё равно сливался по цвету). Аргумент опционален — без него пул
 * это весь реестр (совместимость со старой сигнатурой и тестами без игрока).
 * Скин косметичен и в реплей не пишется (`tank-skin-parity.test.ts`), поэтому
 * зависимость выбора бота от скина игрока реплей не ломает: тот же сид + тот же
 * скин игрока дают того же соперника.
 */
export const selectTankSkinForSeed = (
    seed: number | string,
    excludePlayerSkinId?: TTankSkinId,
): TTankSkinId => {
    const random = createSeededRandom(`${seed}::tank-skin`);
    const excludedPaletteId = excludePlayerSkinId
        ? getTankSkinById(excludePlayerSkinId).palette.id
        : undefined;
    const pool = excludedPaletteId
        ? TANK_SKINS.filter((skin) => skin.palette.id !== excludedPaletteId)
        : TANK_SKINS;
    // Пул не может опустеть (палитр минимум две), но гардим: если реестр когда-то
    // сожмётся до одной палитры — берём весь, а не индексируем пустой массив.
    const candidates = pool.length > 0 ? pool : TANK_SKINS;
    const index = Math.floor(random() * candidates.length);
    // Клэмп на случай теоретического random() === 1 у чужой реализации RNG.
    return candidates[Math.min(index, candidates.length - 1)].id;
};
