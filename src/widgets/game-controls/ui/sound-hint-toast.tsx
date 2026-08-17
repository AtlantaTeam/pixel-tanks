'use client';

import { HUD_SURFACE } from '@/shared/config';
import { SoundPrompt } from '@/shared/lib/audio';
import { TOAST_BOTTOM_PX } from './ammo-empty-toast';

/**
 * Подсказка «нажми — играет музыка» на боевом экране (issue #584): раньше она
 * стояла только на главной — переход `/` → `/game` открывает НОВЫЙ AudioContext
 * (снова suspended), и на боевом экране до первого жеста не было ни звука, ни
 * сигнала об этом. В Chrome это маскирует эвристика вовлечённости, в Safari её
 * нет вовсе — там выглядит как «звук сломан».
 *
 * Сам `SoundPrompt` тот же, что на главной (общий разовый флаг, `sound-hint.ts`) —
 * здесь только оформление под боевой экран: бордер + HUD-подложка, слот над
 * палубой — тот же `TOAST_BOTTOM_PX`, что у `AmmoEmptyToast`. Коллизии не будет:
 * боезапас не бывает пуст на первом ходу, когда эта подсказка ещё актуальна.
 */
export function SoundHintToast() {
    return (
        <div
            // Подписан, как остальные оверлеи арены (`game-hud`, `top-hud`,
            // `aim-hint`, `gesture-zone`): по этим якорям барьеры бюджетов
            // (`overlay-budget.spec.ts`, `arena-safe-zone-viewports.spec.ts`)
            // и эталонные кадры сцены находят слой. Безымянный оверлей для них
            // не существует — а этот садится ровно в свободную арену (ревью #585).
            data-testid="sound-hint-toast"
            className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-2.5"
            style={{ bottom: `calc(${TOAST_BOTTOM_PX}px + env(safe-area-inset-bottom, 0px))` }}
        >
            <SoundPrompt
                className={`border-[length:var(--border-w)] border-accent px-3 py-2 ${HUD_SURFACE}`}
            />
        </div>
    );
}
