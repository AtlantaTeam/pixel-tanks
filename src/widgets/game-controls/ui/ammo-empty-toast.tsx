'use client';

import { selectShowAmmoEmptyToast, useGameStore } from '@/features/game-engine';
import { Toast } from '@/shared/ui';

/**
 * Тост «патроны кончились» (handoff «Патроны кончились», issue #448): свой
 * слой поверх арены — сам монтируется в `views/game-page` рядом с палубой, а
 * не внутри её DOM, и сам решает, показываться ли (`selectShowAmmoEmptyToast`).
 * Позиция считается от арены/safe-area константой `210px` (калибрована по
 * самой высокой деке — мобильной, ≈202px + зазор), а не от `bottom-full`
 * контейнера деки: состав деки по брейкпоинту (селектор/манёвр/подсказка
 * жеста) и её реальная высота на позицию тоста больше не влияют, поэтому
 * появление/скрытие тоста не двигает ни HUD, ни палубу. Манёвр при этом
 * остаётся активным — тост только предупреждает, что огонь недоступен, ход
 * не блокирует.
 */
export function AmmoEmptyToast() {
    const show = useGameStore(selectShowAmmoEmptyToast);
    if (!show) return null;

    return (
        <div
            className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-2.5"
            style={{ bottom: 'calc(210px + env(safe-area-inset-bottom, 0px))' }}
        >
            <Toast
                variant="warning"
                message="Патроны кончились — остался только манёвр. Ход перейдёт сопернику."
                className="max-w-sm"
            />
        </div>
    );
}
