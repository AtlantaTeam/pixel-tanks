'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_TANK_SKIN_ID, isTankSkinId } from '../tank-skins.data';
import type { TTankSkinId } from '../t-tank-skin';

// Единый источник истины выбора скина — localStorage, как mute (`use-mute-state.ts`):
// фазы 7 (auth+профиль) ещё нет, поэтому «сохранение в профиле» из issue #481
// реализовано локальным предпочтением устройства, тем же паттерном, что и звук.
const SKIN_STORAGE_KEY = 'tank-skin';
const listeners = new Set<() => void>();

function readSkinId(): TTankSkinId {
    if (typeof localStorage === 'undefined') return DEFAULT_TANK_SKIN_ID;
    const stored = localStorage.getItem(SKIN_STORAGE_KEY);
    // Битое/устаревшее значение (старая версия реестра) — тихий фолбэк на дефолт,
    // а не падение экрана: выбор скина не должен ронять игру.
    return stored && isTankSkinId(stored) ? stored : DEFAULT_TANK_SKIN_ID;
}

// Сервер не знает выбор клиента — до гидратации отдаём дефолт (как readServerMuted).
function readServerSkinId(): TTankSkinId {
    return DEFAULT_TANK_SKIN_ID;
}

function subscribe(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    // 'storage' прилетает только из других вкладок — подхватываем выбор оттуда,
    // чтобы скин не расходился между открытыми вкладками игры.
    const onStorage = (e: StorageEvent) => {
        if (e.key === SKIN_STORAGE_KEY) onStoreChange();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(onStoreChange);
        window.removeEventListener('storage', onStorage);
    };
}

function writeSkinId(id: TTankSkinId): void {
    localStorage.setItem(SKIN_STORAGE_KEY, id);
    for (const listener of listeners) listener();
}

/** Текущий выбор игрока вне React (движок читает его сам на старте боя). */
export function getStoredTankSkinId(): TTankSkinId {
    return readSkinId();
}

export function useTankSkinPreference() {
    const skinId = useSyncExternalStore(subscribe, readSkinId, readServerSkinId);

    const setSkinId = (id: TTankSkinId) => {
        writeSkinId(id);
    };

    return { skinId, setSkinId };
}
