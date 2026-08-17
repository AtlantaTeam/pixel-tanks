import { useEffect, useState } from 'react';
import { getDevicePixelRatio } from './dpr';

/**
 * `devicePixelRatio`, который переживает СМЕНУ dpr — перенос окна на монитор с другой
 * плотностью или зум страницы (ревью #579).
 *
 * Нужен канвасам ФИКСИРОВАННОГО размера: там `ResizeObserver` (приём `TankWheelDemo`)
 * не сработал бы вовсе — CSS-размер канваса не меняется, меняется только плотность, и
 * бэкинг-стор молча остаётся от старого dpr, а картинка мылится. Ловим смену тем же
 * `matchMedia`, что и остальные медиа-запросы движка: запрос `(resolution: Ndppx)`
 * перестаёт совпадать ровно тогда, когда dpr стал другим. Запрос пересоздаётся на
 * каждом новом значении, поэтому эффект зависит от самого `dpr`.
 *
 * Живёт рядом с `getDevicePixelRatio`/`toDevicePixels` (`shared/lib/canvas`), с которыми
 * всегда используется в паре, а не внутри компонента-потребителя (ревью #579).
 */
export function useDevicePixelRatio(): number {
    const [dpr, setDpr] = useState(getDevicePixelRatio);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
        const onChange = () => setDpr(getDevicePixelRatio());
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, [dpr]);

    return dpr;
}
