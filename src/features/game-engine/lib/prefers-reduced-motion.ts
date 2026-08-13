/**
 * Снимок системной настройки `prefers-reduced-motion: reduce`. Читается один раз
 * на старте сцены (как в `CameraShake`/`SlowMotion`), а не подписывается на смену:
 * бой короткий, а смена настройки среди боя не стоит подписки. Вне браузера
 * (SSR/тесты без мока) — `false`: движение по умолчанию разрешено.
 */
export const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
