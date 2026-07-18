import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMuteState } from './use-mute-state';
import { getAudioEngine } from './audio-engine';

describe('useMuteState', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('reads mute state from localStorage on mount', () => {
        localStorage.setItem('audio-mute', 'true');
        const { result } = renderHook(() => useMuteState());
        expect(result.current.isMuted).toBe(true);
    });

    it('defaults to false when localStorage is empty', () => {
        const { result } = renderHook(() => useMuteState());
        expect(result.current.isMuted).toBe(false);
    });

    it('toggles mute state and persists to localStorage', () => {
        const { result } = renderHook(() => useMuteState());
        expect(result.current.isMuted).toBe(false);

        act(() => {
            result.current.toggle();
        });

        expect(result.current.isMuted).toBe(true);
        expect(localStorage.getItem('audio-mute')).toBe('true');
    });

    it('toggles back to unmuted and updates localStorage', () => {
        localStorage.setItem('audio-mute', 'true');
        const { result } = renderHook(() => useMuteState());
        expect(result.current.isMuted).toBe(true);

        act(() => {
            result.current.toggle();
        });

        expect(result.current.isMuted).toBe(false);
        expect(localStorage.getItem('audio-mute')).toBe('false');
    });

    it('setMuted updates state and localStorage', () => {
        const { result } = renderHook(() => useMuteState());

        act(() => {
            result.current.setMuted(true);
        });

        expect(result.current.isMuted).toBe(true);
        expect(localStorage.getItem('audio-mute')).toBe('true');
    });

    it('applies mute state to audio engine', () => {
        const setMutedSpy = vi.spyOn(getAudioEngine(), 'setMuted');
        const { result } = renderHook(() => useMuteState());

        act(() => {
            result.current.setMuted(true);
        });

        expect(result.current.isMuted).toBe(true);
        expect(setMutedSpy).toHaveBeenCalledWith(true);
    });
});
