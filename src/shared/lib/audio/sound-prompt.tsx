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

    // Промпт НЕ размонтируется, а гаснет: раньше он возвращал null, строка исчезала
    // из потока, колонка схлопывалась — и вся страница подпрыгивала ровно в момент
    // клика, под курсором/пальцем (#522). Место за ним остаётся навсегда: цена —
    // одна пустая строка, зато раскладка неподвижна.
    return (
        <p
            aria-hidden
            className={`font-ui flex items-center gap-1 text-[10px] text-primary/90 transition-opacity duration-300 sm:text-xs motion-reduce:transition-none ${
                dismissed
                    ? 'pointer-events-none opacity-0'
                    : 'animate-pulse motion-reduce:animate-none'
            }`}
        >
            <Icon name="play" size={12} />
            нажми — играет музыка
        </p>
    );
}
