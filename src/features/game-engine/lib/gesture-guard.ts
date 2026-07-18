/**
 * Защита от конфликтов жестов на игровом Canvas.
 *
 * `touch-action: none` (класс `touch-none` на Canvas) гасит одно-пальцевый
 * скролл и стандартный браузерный пинч-зум. Но iOS Safari масштабирует
 * страницу нестандартными событиями `gesturestart`/`gesturechange`, которые
 * `touch-action` НЕ покрывает, — их нужно гасить вручную.
 *
 * Слушатели вешаются ТОЛЬКО на переданный элемент, поэтому системные жесты
 * браузера вне Canvas (скролл соседних блоков, свайпы навигации) не ломаются.
 *
 * @returns функция-очистка, снимающая все навешанные слушатели.
 */
export function attachGestureGuard(el: HTMLElement): () => void {
    // iOS Safari pinch-zoom: нестандартные gesture-события — гасим всегда,
    // пока жест начался на Canvas.
    const onGesture = (e: Event) => e.preventDefault();

    // Мультитач-touchmove (два и более касания) — это пинч-зум. Одиночное
    // касание оставляем: это жест прицеливания «оттяни и отпусти».
    const onTouchMove = (e: Event) => {
        const touches = (e as TouchEvent).touches;
        if (touches && touches.length > 1) e.preventDefault();
    };

    // passive: false обязателен — иначе preventDefault игнорируется браузером.
    el.addEventListener('gesturestart', onGesture, { passive: false });
    el.addEventListener('gesturechange', onGesture, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
        el.removeEventListener('gesturestart', onGesture);
        el.removeEventListener('gesturechange', onGesture);
        el.removeEventListener('touchmove', onTouchMove);
    };
}
