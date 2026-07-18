import type { TMusicTrack, TSfxName } from './t-audio';

// Оригинальные мелодии Андрея и звуки боя. Единый источник — public/audio/
// (перенесены из старого static/audio/ в фазе 5).
export const SFX_SOURCES: Record<TSfxName, string> = {
    fire: '/audio/fire.wav',
    hit: '/audio/explosion-hit.wav',
    miss: '/audio/explosion-miss.wav',
};

export const MUSIC_SOURCES: Record<TMusicTrack, string> = {
    menu: '/audio/game-menu.mp3',
    battle: '/audio/gameplay.mp3',
};

// Музыка тише эффектов: фон не должен перекрывать выстрел/взрыв.
export const MUSIC_VOLUME = 0.4;
export const SFX_VOLUME = 0.8;
