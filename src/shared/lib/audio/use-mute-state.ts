'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getAudioEngine } from './audio-engine';

const MUTE_STORAGE_KEY = 'audio-mute';
const listeners = new Set<() => void>();

function readMuted(): boolean {
    return localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
}

// Сервер не знает mute-состояние клиента — до гидратации считаем звук включённым.
function readServerMuted(): boolean {
    return false;
}

function subscribe(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    // Событие 'storage' прилетает только из других вкладок — подхватываем их mute,
    // чтобы состояние не разъезжалось между открытыми вкладками игры.
    const onStorage = (e: StorageEvent) => {
        if (e.key === MUTE_STORAGE_KEY) onStoreChange();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(onStoreChange);
        window.removeEventListener('storage', onStorage);
    };
}

function writeMuted(muted: boolean): void {
    localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
    for (const listener of listeners) listener();
}

export function useMuteState() {
    const isMuted = useSyncExternalStore(subscribe, readMuted, readServerMuted);

    // Синхронизация внешней системы (движок) с прочитанным React-состоянием —
    // разрешённый паттерн эффекта, в отличие от setState внутри эффекта.
    useEffect(() => {
        getAudioEngine().setMuted(isMuted);
    }, [isMuted]);

    const setMuted = (muted: boolean) => {
        writeMuted(muted);
    };

    const toggle = () => {
        setMuted(!isMuted);
    };

    return {
        isMuted,
        setMuted,
        toggle,
    };
}
