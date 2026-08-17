'use client';

import { useSyncExternalStore } from 'react';

/**
 * Разовый флаг «пользователь это уже видел», переживающий перезагрузку и переход
 * между экранами (ревью #585).
 *
 * До этой фабрики паттерн жил построчными копиями: `aim-hint.ts` (#565) и
 * `sound-hint.ts` (#584) совпадали целиком, отличаясь только строкой ключа, — и
 * правка семантики (синхронизация вкладок, обработка `QuotaExceeded`, миграция
 * ключей) требовала помнить про все копии. Здесь она одна.
 *
 * Почему не Zustand и не контекст: флаг читают и пишут в том числе обработчики
 * канваса вне React-дерева (`markAimHintSeen` зовётся из движка), а значение —
 * предпочтение устройства, а не состояние боя. Профиля пользователя ещё нет,
 * поэтому хранилище — `localStorage`, как у выбора скина и mute.
 */
export type TPersistentFlag = {
    /** Ключ в localStorage — экспортируется, чтобы тесты не дублировали строку. */
    key: string;
    /** Пометить флаг поднятым (идемпотентно) и разбудить подписчиков. */
    mark: () => void;
    /** Реактивное чтение флага для рендера. */
    useFlag: () => boolean;
};

export function createPersistentFlag(key: string): TPersistentFlag {
    const listeners = new Set<() => void>();

    // SSR/тесты без localStorage: считаем «ещё не видел» — подсказка появится на
    // клиенте после гидратации, а не уронит рендер.
    const read = (): boolean => {
        if (typeof localStorage === 'undefined') return false;
        try {
            return localStorage.getItem(key) === '1';
        } catch {
            // Приватный режим/заблокированный storage — не роняем экран из-за флага.
            return false;
        }
    };

    // Сервер не знает состояние клиента — до гидратации считаем «уже видел», иначе
    // разметка сервера и клиента разойдутся (как readServerSkinId/readServerMuted).
    const readServer = (): boolean => true;

    const subscribe = (onStoreChange: () => void): (() => void) => {
        listeners.add(onStoreChange);
        // 'storage' прилетает из других вкладок — если флаг подняли там, гасим
        // подсказку и здесь, чтобы не показать «один раз» дважды в двух вкладках.
        const onStorage = (e: StorageEvent) => {
            if (e.key === key) onStoreChange();
        };
        window.addEventListener('storage', onStorage);
        return () => {
            listeners.delete(onStoreChange);
            window.removeEventListener('storage', onStorage);
        };
    };

    const mark = (): void => {
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(key, '1');
            } catch {
                // Storage недоступен — подсказку просто покажем ещё раз, это не критично.
            }
        }
        // Подписчиков будим в любом случае: даже когда запись не удалась, текущая
        // сессия обязана погасить подсказку — жест-то был.
        for (const listener of listeners) listener();
    };

    const useFlag = (): boolean => useSyncExternalStore(subscribe, read, readServer);

    return { key, mark, useFlag };
}
