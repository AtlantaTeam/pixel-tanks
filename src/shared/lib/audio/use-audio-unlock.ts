'use client';

import { useEffect } from 'react';
import { getAudioEngine } from './audio-engine';

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * Браузеры держат AudioContext suspended до первого пользовательского жеста —
 * без этого попытка играть звук молча проваливается (или Chrome логирует
 * autoplay-warning). Слушает первый клик/тап/нажатие клавиши где угодно на
 * странице, разблокирует общий движок и снимает слушатели.
 */
export function useAudioUnlock(): void {
    useEffect(() => {
        const controller = new AbortController();

        const unlock = () => {
            void getAudioEngine().resume();
            controller.abort();
        };

        for (const type of UNLOCK_EVENTS) {
            window.addEventListener(type, unlock, { signal: controller.signal });
        }

        return () => controller.abort();
    }, []);
}
