'use client';

import { useEffect } from 'react';
import { getAudioEngine } from './audio-engine';
import type { TMusicTrack } from './t-audio';

/**
 * Проигрывает музыку сцены, пока компонент смонтирован. Смена страницы →
 * смена трека: движок сам останавливает предыдущий. Музыку не глушим на
 * размонтировании — следующая сцена бесшовно её заменит.
 */
export function useSceneMusic(track: TMusicTrack): void {
    useEffect(() => {
        void getAudioEngine().playMusic(track);
    }, [track]);
}
