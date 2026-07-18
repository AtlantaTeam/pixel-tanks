'use client';

import { useSceneMusic } from './use-scene-music';
import type { TMusicTrack } from './t-audio';

type TSceneMusicProps = {
    track: TMusicTrack;
};

/**
 * Ничего не рендерит — только включает музыку сцены. Позволяет держать
 * страницы серверными компонентами, вставляя точечный клиентский триггер.
 */
export function SceneMusic({ track }: TSceneMusicProps) {
    useSceneMusic(track);
    return null;
}
