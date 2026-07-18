// devicePixelRatio с защитой от 0 / undefined (SSR, старые браузеры).
export const getDevicePixelRatio = () =>
    typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

// Размер бэкинг-стора canvas в физических пикселях под текущий dpr.
// CSS-размер остаётся логическим, ctx масштабируется на dpr — картинка чёткая на ретине.
export const toDevicePixels = (cssSize: number, dpr: number) => Math.round(cssSize * dpr);
