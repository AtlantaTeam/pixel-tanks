import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

type THoldRepeatOptions = {
    /** Пауза перед началом авто-повтора при удержании (мс). */
    initialDelayMs?: number;
    /** Интервал между повторами при удержании (мс). */
    intervalMs?: number;
};

/**
 * Авто-повтор действия при удержании кнопки (hold-to-repeat). Набирать мощность
 * шагом ±1, тыкая кнопку, было слишком долго на диапазоне 1..20 (#264).
 *
 * Хук владеет и `onClick` кнопки: одиночный тап и клавиатура (Enter/Space шлют
 * click без pointer-событий) делают ровно один шаг, а при удержании шаги набирают
 * тики интервала. `onClick` приходит на отпускании уже после `stop`, поэтому
 * «хвостовой» клик после состоявшегося авто-повтора глотается — иначе удержание
 * давало бы «тики + 1». Повтор включается только после `initialDelayMs` — быстрый
 * тап лишних шагов не даёт.
 */
export function useHoldRepeat(action: () => void, options: THoldRepeatOptions = {}) {
    const { initialDelayMs = 350, intervalMs = 80 } = options;

    const actionRef = useRef(action);
    // Синхронизируем свежий колбэк вне рендера (запись ref в теле рендера
    // запрещена react-hooks/refs) — интервал зовёт актуальную версию.
    useEffect(() => {
        actionRef.current = action;
    });

    const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
    // Успел ли за текущее удержание сработать хотя бы один тик авто-повтора —
    // тогда следующий `onClick` (приходит на отпускании) считается «хвостовым».
    const repeatFiredRef = useRef(false);

    const stop = () => {
        clearTimeout(timeoutRef.current);
        clearInterval(intervalRef.current);
        timeoutRef.current = undefined;
        intervalRef.current = undefined;
    };

    const start = (e: ReactPointerEvent) => {
        // Только основная кнопка мыши / касание — правый клик и т.п. не держим.
        if (e.button !== 0) return;
        stop();
        repeatFiredRef.current = false;
        timeoutRef.current = setTimeout(() => {
            intervalRef.current = setInterval(() => {
                repeatFiredRef.current = true;
                actionRef.current();
            }, intervalMs);
        }, initialDelayMs);
    };

    const handleClick = () => {
        // После авто-повтора клик-«хвост» глотаем (один раз), чтобы не добавить
        // лишний шаг поверх тиков. Тап и клавиатура повтора не запускают — клик
        // проходит и делает ровно один шаг.
        if (repeatFiredRef.current) {
            repeatFiredRef.current = false;
            return;
        }
        actionRef.current();
    };

    // Снять таймеры при размонтировании — иначе интервал переживёт компонент.
    useEffect(() => stop, []);

    return {
        onClick: handleClick,
        onPointerDown: start,
        onPointerUp: stop,
        onPointerLeave: stop,
        onPointerCancel: stop,
    };
}
