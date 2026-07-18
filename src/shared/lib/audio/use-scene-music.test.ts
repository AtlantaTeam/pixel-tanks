import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSceneMusic } from './use-scene-music';
import * as audioEngineModule from './audio-engine';
import type { TMusicTrack } from './t-audio';

describe('useSceneMusic', () => {
    const playMusic = vi.fn(async () => undefined);

    beforeEach(() => {
        playMusic.mockClear();
        vi.spyOn(audioEngineModule, 'getAudioEngine').mockReturnValue({
            playMusic,
        } as unknown as audioEngineModule.AudioEngine);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('plays the given track on mount', () => {
        renderHook(() => useSceneMusic('menu'));
        expect(playMusic).toHaveBeenCalledWith('menu');
    });

    it('switches to the new track when the prop changes', () => {
        const { rerender } = renderHook(({ track }) => useSceneMusic(track), {
            initialProps: { track: 'menu' as TMusicTrack },
        });
        rerender({ track: 'battle' });
        expect(playMusic).toHaveBeenCalledWith('battle');
        expect(playMusic).toHaveBeenCalledTimes(2);
    });

    it('does not replay when rerendered with the same track', () => {
        const { rerender } = renderHook(({ track }) => useSceneMusic(track), {
            initialProps: { track: 'menu' as TMusicTrack },
        });
        rerender({ track: 'menu' });
        expect(playMusic).toHaveBeenCalledTimes(1);
    });
});
