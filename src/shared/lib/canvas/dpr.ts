// devicePixelRatio с защитой от 0 / undefined (SSR, старые браузеры).
export const getDevicePixelRatio = () =>
    typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

// Размер бэкинг-стора canvas в физических пикселях под текущий dpr.
// CSS-размер остаётся логическим, ctx масштабируется на dpr — картинка чёткая на ретине.
export const toDevicePixels = (cssSize: number, dpr: number) => Math.round(cssSize * dpr);

// Прижать логическую координату к сетке устройственных пикселей: на дробном dpr без
// этого пиксельный арт «плывёт» полупрозрачной каймой сглаживания.
//
// Функция модульная, а не замыкание внутри метода рисования: сцены зовут её из горячего
// пути (`drawClouds`, `paintDust`, слой осадков), и `const snap = …` пересоздавался там
// каждый кадр — прямое нарушение «никаких аллокаций в кадре» (.claude/rules/canvas.md).
export const snapToDevicePixel = (value: number, dpr: number) => Math.round(value * dpr) / dpr;
