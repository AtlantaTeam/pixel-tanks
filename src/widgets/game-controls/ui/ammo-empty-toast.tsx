'use client';

import { selectShowAmmoEmptyToast, useGameStore } from '@/features/game-engine';
import { Toast } from '@/shared/ui';

/** Высота самой высокой (мобильной) деки — по её составу (селектор + ряд
 *  манёвр/ОГОНЬ + подсказка жеста). Меняешь состав/паддинги мобильной деки в
 *  `game-controls` — правишь это значение здесь, иначе тост тихо разъедется с
 *  декой (поймает только e2e-падение без подсказки на причину). */
const MOBILE_DECK_HEIGHT_PX = 202;
/** Зазор между верхом деки и тостом. */
const TOAST_GAP_PX = 8;
/** Отступ тоста от низа арены. `env(safe-area-inset-bottom)` добавляется отдельно
 *  в `bottom` и взаимно сокращается с safe-area-паддингом деки.
 *
 *  Экспортируется — тот же слот переиспользует `SoundHintToast` (issue #584):
 *  на первом ходу боезапас никогда не пуст, поэтому коллизии с этим тостом нет,
 *  а держать для второго слоя отдельную копию той же пиксельной математики —
 *  верный способ однажды рассинхронить их с реальной высотой деки. */
export const TOAST_BOTTOM_PX = MOBILE_DECK_HEIGHT_PX + TOAST_GAP_PX;

/**
 * Тост «патроны кончились» (handoff «Патроны кончились», issue #448): свой
 * слой поверх арены — сам монтируется в `views/game-page` рядом с палубой, а
 * не внутри её DOM, и сам решает, показываться ли (`selectShowAmmoEmptyToast`).
 * Позиция считается от арены/safe-area константой `TOAST_BOTTOM_PX` (калибрована
 * по самой высокой деке — мобильной, см. `MOBILE_DECK_HEIGHT_PX`), а не от
 * `bottom-full` контейнера деки: состав деки по брейкпоинту (селектор/манёвр/
 * подсказка жеста) и её реальная высота на позицию тоста больше не влияют,
 * поэтому появление/скрытие тоста не двигает ни HUD, ни палубу. Манёвр при этом
 * остаётся активным — тост только предупреждает, что огонь недоступен, ход
 * не блокирует.
 */
export function AmmoEmptyToast() {
    const show = useGameStore(selectShowAmmoEmptyToast);
    if (!show) return null;

    return (
        <div
            className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-2.5"
            style={{ bottom: `calc(${TOAST_BOTTOM_PX}px + env(safe-area-inset-bottom, 0px))` }}
        >
            <Toast
                variant="warning"
                message="Патроны кончились — остался только манёвр. Ход перейдёт сопернику."
                className="max-w-sm"
            />
        </div>
    );
}
