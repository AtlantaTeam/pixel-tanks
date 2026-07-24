'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/shared/ui';

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * Аркадный промпт «нажми для звука». Браузеры не дают автоплей музыки до
 * первого жеста пользователя (движение мыши/скролл активацией не считаются),
 * поэтому подсказываем: один клик/тап/клавиша включит музыку. Тот же жест
 * разблокирует общий AudioContext через AudioUnlock в layout, а промпт гаснет.
 */
export function SoundPrompt() {
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        const dismiss = () => {
            setDismissed(true);
            controller.abort();
        };
        for (const type of UNLOCK_EVENTS) {
            window.addEventListener(type, dismiss, { signal: controller.signal });
        }
        return () => controller.abort();
    }, []);

    if (dismissed) return null;

    return (
        <p
            aria-hidden
            className="animate-pulse font-ui text-[10px] text-primary/90 sm:text-xs motion-reduce:animate-none flex items-center gap-1"
        >
            <Icon name="play" size={12} />
            нажми — играет музыка
        </p>
    );
}
