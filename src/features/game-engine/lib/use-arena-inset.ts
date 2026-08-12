'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '../model/game.store';
import type { TArenaInsets } from './arena-insets';

/**
 * Публикует фактическую высоту оверлея (верхнего HUD или нижней палубы) в инсеты
 * арены — часть контракта safe-зоны (issue #453). Возвращает ref, который надо
 * повесить на корневой узел оверлея; хук замеряет его `ResizeObserver` и на каждое
 * изменение высоты пишет в стор (`setArenaInset`).
 *
 * Почему высоты меряем здесь, а не хардкодим: они разные на брейкпоинтах, зависят
 * от safe-area устройства и (до фазы 1 трека) от фазы боя. `ResizeObserver` — их
 * единственный честный источник; стор боя — единственное место правды по инсетам
 * (см. `arena-insets.ts`), откуда их читает движок.
 *
 * Владелец жизненного цикла инсета — этот хук: публикует высоту на монтировании и
 * обнуляет грань на размонтировании (стор — модульный синглтон и переживает
 * размонтирование, иначе инсет прошлого экрана завис бы). Поэтому `startGame`/
 * `resetGame` инсеты не трогают.
 */
export function useArenaInset<T extends HTMLElement = HTMLElement>(edge: keyof TArenaInsets) {
    const ref = useRef<T>(null);
    const setArenaInset = useGameStore((s) => s.setArenaInset);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        // getBoundingClientRect().height — полная визуальная высота (с паддингами и
        // safe-area), ровно та, которой оверлей закрывает арену.
        const publish = () => setArenaInset(edge, el.getBoundingClientRect().height);
        publish();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(publish);
        observer.observe(el);
        return () => {
            observer.disconnect();
            // Оверлей ушёл — освобождаем свою грань, чтобы стор-синглтон не держал
            // высоту размонтированного экрана.
            setArenaInset(edge, 0);
        };
    }, [edge, setArenaInset]);

    return ref;
}
