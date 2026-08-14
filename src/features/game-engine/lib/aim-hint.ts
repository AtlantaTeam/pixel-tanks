'use client';

import { useSyncExternalStore } from 'react';

/**
 * Разовая подсказка прицеливания (issue #565): раньше обучающие строки
 * («ОТПУСТИ — ВЫСТРЕЛ», «только направление · падение не показываем») висели в
 * чипе на КАЖДОМ жесте КАЖДОГО боя. Теперь они показываются один раз и факт
 * «уже видел» переживает перезагрузку — хранится в localStorage тем же паттерном,
 * что выбор скина (`tank-skin-preference.ts`) и mute (`use-mute-state.ts`): фичи
 * профиля ещё нет, предпочтение живёт на устройстве.
 */
const AIM_HINT_STORAGE_KEY = 'pt-aim-hint-seen';
const listeners = new Set<() => void>();

function readAimHintSeen(): boolean {
    // SSR/тесты без localStorage: считаем «ещё не видел» — подсказка появится на
    // клиенте после гидратации, а не уронит рендер.
    if (typeof localStorage === 'undefined') return false;
    try {
        return localStorage.getItem(AIM_HINT_STORAGE_KEY) === '1';
    } catch {
        // Приватный режим/заблокированный storage — не роняем экран из-за подсказки.
        return false;
    }
}

// Сервер не знает состояние клиента — до гидратации подсказку не показываем, иначе
// разметка сервера и клиента разойдутся (как readServerSkinId/readServerMuted).
function readServerAimHintSeen(): boolean {
    return true;
}

function subscribe(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    // 'storage' прилетает из других вкладок — если подсказку закрыли там, гасим её
    // и здесь, чтобы не показать «один раз» дважды в двух вкладках.
    const onStorage = (e: StorageEvent) => {
        if (e.key === AIM_HINT_STORAGE_KEY) onStoreChange();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(onStoreChange);
        window.removeEventListener('storage', onStorage);
    };
}

/**
 * Пометить подсказку показанной (идемпотентно): следующий бой и перезагрузка её
 * больше не покажут. Модульная функция со стабильной ссылкой — вызывается из
 * обработчиков канваса без попадания в deps эффектов.
 */
export function markAimHintSeen(): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(AIM_HINT_STORAGE_KEY, '1');
    } catch {
        // Storage недоступен — подсказку просто покажем ещё раз, это не критично.
    }
    for (const listener of listeners) listener();
}

/** Реактивный флаг «подсказку уже видели» для рендера оверлея. */
export function useAimHintSeen(): boolean {
    return useSyncExternalStore(subscribe, readAimHintSeen, readServerAimHintSeen);
}
