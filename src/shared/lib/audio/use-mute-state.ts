'use client';

import { useEffect, useState } from 'react';
import { getAudioEngine } from './audio-engine';

const MUTE_STORAGE_KEY = 'audio-mute';

export function useMuteState() {
    const [isMuted, setIsMutedState] = useState<boolean>(false);
    const [isHydrated, setIsHydrated] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem(MUTE_STORAGE_KEY);
        const initialMuted = stored === 'true';
        setIsMutedState(initialMuted);
        getAudioEngine().setMuted(initialMuted);
        setIsHydrated(true);
    }, []);

    const setMuted = (muted: boolean) => {
        setIsMutedState(muted);
        localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
        getAudioEngine().setMuted(muted);
    };

    const toggle = () => {
        setMuted(!isMuted);
    };

    return {
        isMuted,
        setMuted,
        toggle,
        isHydrated,
    };
}
