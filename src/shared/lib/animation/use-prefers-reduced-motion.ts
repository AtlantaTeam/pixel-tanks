'use client';

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * JS-версия `motion-reduce:` для случаев, где анимацию нельзя выключить одним
 * Tailwind-классом (напр. посимвольная печать бабла крутится в `setInterval`,
 * а не в CSS) — CSS-only анимации (blink, pulse) достаточно `motion-reduce:
 * animate-none` прямо в классе, этот хук им не нужен.
 */
export function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(
        () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
    );

    useEffect(() => {
        // Начальное значение уже читает lazy-инициализатор `useState` выше —
        // здесь только подписка на дальнейшие изменения предпочтения.
        const mql = window.matchMedia(QUERY);
        const onChange = () => setReduced(mql.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);

    return reduced;
}
