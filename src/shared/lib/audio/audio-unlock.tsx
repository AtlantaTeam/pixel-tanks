'use client';

import { useAudioUnlock } from './use-audio-unlock';

/**
 * Ничего не рендерит — только слушает первый жест пользователя, чтобы
 * разблокировать AudioContext. Ставится один раз в корневом layout.
 */
export function AudioUnlock() {
    useAudioUnlock();
    return null;
}
