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
 * Прогрессивное улучшение поверх обычного `onClick`: первый шаг делает сам клик
 * (клавиатура и одиночный тап работают как прежде), а повтор включается только
 * после `initialDelayMs` удержания — быстрый тап лишних шагов не даёт.
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
        timeoutRef.current = setTimeout(() => {
            intervalRef.current = setInterval(() => actionRef.current(), intervalMs);
        }, initialDelayMs);
    };

    // Снять таймеры при размонтировании — иначе интервал переживёт компонент.
    useEffect(() => stop, []);

    return {
        onPointerDown: start,
        onPointerUp: stop,
        onPointerLeave: stop,
        onPointerCancel: stop,
    };
}
