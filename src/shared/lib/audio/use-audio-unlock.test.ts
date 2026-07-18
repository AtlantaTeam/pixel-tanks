import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioUnlock } from './use-audio-unlock';
import * as audioEngineModule from './audio-engine';

describe('useAudioUnlock', () => {
    const resume = vi.fn(async () => undefined);

    beforeEach(() => {
        resume.mockClear();
        vi.spyOn(audioEngineModule, 'getAudioEngine').mockReturnValue({
            resume,
        } as unknown as audioEngineModule.AudioEngine);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not resume the engine before any user gesture', () => {
        renderHook(() => useAudioUnlock());
        expect(resume).not.toHaveBeenCalled();
    });

    it('resumes the engine on the first pointerdown anywhere on the page', () => {
        renderHook(() => useAudioUnlock());
        window.dispatchEvent(new Event('pointerdown'));
        expect(resume).toHaveBeenCalledTimes(1);
    });

    it('resumes the engine on the first keydown anywhere on the page', () => {
        renderHook(() => useAudioUnlock());
        window.dispatchEvent(new Event('keydown'));
        expect(resume).toHaveBeenCalledTimes(1);
    });

    it('resumes the engine on the first touchstart anywhere on the page', () => {
        renderHook(() => useAudioUnlock());
        window.dispatchEvent(new Event('touchstart'));
        expect(resume).toHaveBeenCalledTimes(1);
    });

    it('stops listening after the first gesture', () => {
        renderHook(() => useAudioUnlock());
        window.dispatchEvent(new Event('pointerdown'));
        window.dispatchEvent(new Event('keydown'));
        window.dispatchEvent(new Event('touchstart'));
        expect(resume).toHaveBeenCalledTimes(1);
    });

    it('removes its listeners on unmount', () => {
        const { unmount } = renderHook(() => useAudioUnlock());
        unmount();
        window.dispatchEvent(new Event('pointerdown'));
        expect(resume).not.toHaveBeenCalled();
    });
});
