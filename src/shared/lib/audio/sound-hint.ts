'use client';

import { useSyncExternalStore } from 'react';

/**
 * Разовый флаг подсказки звука (issue #584): раньше `SoundPrompt` держал
 * видимость в локальном `useState` — гасла по клику, но появлялась заново на
 * КАЖДОМ маунте, включая переход на `/game` (новый `AudioContext`, снова
 * suspended). Теперь факт «уже видел» переживает переход между экранами и
 * перезагрузку — localStorage, тот же паттерн, что `aim-hint.ts` (#565).
 */
const SOUND_HINT_STORAGE_KEY = 'pt-sound-hint-seen';
const listeners = new Set<() => void>();

function readSoundHintSeen(): boolean {
    // SSR/тесты без localStorage: считаем «ещё не видел» — подсказка появится на
    // клиенте после гидратации, а не уронит рендер.
    if (typeof localStorage === 'undefined') return false;
    try {
        return localStorage.getItem(SOUND_HINT_STORAGE_KEY) === '1';
    } catch {
        // Приватный режим/заблокированный storage — не роняем экран из-за подсказки.
        return false;
    }
}

// Сервер не знает состояние клиента — до гидратации подсказку не показываем, иначе
// разметка сервера и клиента разойдутся (как readServerAimHintSeen).
function readServerSoundHintSeen(): boolean {
    return true;
}

function subscribe(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    // 'storage' прилетает из других вкладок — если подсказку закрыли там, гасим её
    // и здесь, чтобы не показать «один раз» дважды в двух вкладках.
    const onStorage = (e: StorageEvent) => {
        if (e.key === SOUND_HINT_STORAGE_KEY) onStoreChange();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(onStoreChange);
        window.removeEventListener('storage', onStorage);
    };
}

/**
 * Пометить подсказку показанной (идемпотентно): следующий бой, другой экран и
 * перезагрузка её больше не покажут.
 */
export function markSoundHintSeen(): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(SOUND_HINT_STORAGE_KEY, '1');
    } catch {
        // Storage недоступен — подсказку просто покажем ещё раз, это не критично.
    }
    for (const listener of listeners) listener();
}

/** Реактивный флаг «подсказку уже видели» для рендера `SoundPrompt`. */
export function useSoundHintSeen(): boolean {
    return useSyncExternalStore(subscribe, readSoundHintSeen, readServerSoundHintSeen);
}
