import { getTankSkinById } from '../tank-skins.data';
import type { TTankSkinId } from '../t-tank-skin';

export type TTankSkinImages = {
    hull: HTMLImageElement;
    barrel: HTMLImageElement;
};

/**
 * Кэш отрисовки скинов (issue #481). Грабля из карточки: `librsvg` не понимает
 * `var()`, а внешний SVG в `<img>`/на канвасе не наследует стили страницы —
 * поэтому геометрии (`lib/geometry-*`) подставляют цвета в строку САМИ, и здесь
 * только кодируем готовую строку в `data:` URL. Без кэша каждый кадр боя
 * пересобирал бы `Image` заново — заметная просадка FPS (правило `canvas.md`:
 * «никаких аллокаций в кадре»). Ключ кэша — id скина: одна и та же пара
 * геометрия+палитра всегда даёт один и тот же `Image`.
 */
const cache = new Map<TTankSkinId, Promise<TTankSkinImages>>();

function loadImage(svgMarkup: string): Promise<HTMLImageElement> {
    const img = new Image();
    const ready = new Promise<HTMLImageElement>((resolve) => {
        // onerror тоже разрешает промис (не reject): битый скин не должен вешать
        // весь бой на бесконечном ожидании Promise.all в GamePlay.loadImages —
        // танк отрисуется пустым прямоугольником (Tank.draw гардит tankBodyImg).
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
    });
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
    return ready;
}

/**
 * Отдаёт (и кэширует) пару картинок скина — корпус и ствол. Повторный вызов с
 * тем же `skinId` возвращает ТУ ЖЕ промис-запись из кэша, не создавая новый
 * `Image` (см. `tank-skin-image-cache.test.ts` — критерий готовности #481).
 */
export function loadTankSkinImages(skinId: TTankSkinId): Promise<TTankSkinImages> {
    const cached = cache.get(skinId);
    if (cached) return cached;

    const skin = getTankSkinById(skinId);
    const promise = Promise.all([
        loadImage(skin.geometry.buildHullSvg(skin.palette)),
        loadImage(skin.geometry.buildBarrelSvg(skin.palette)),
    ]).then(([hull, barrel]) => ({ hull, barrel }));

    cache.set(skinId, promise);
    return promise;
}

/** Сброс кэша между тестовыми сценариями — сам кэш не должен пережить дом-заглушки теста. */
export function resetTankSkinImageCache(): void {
    cache.clear();
}
