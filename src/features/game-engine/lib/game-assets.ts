import { whenDecoded } from '@/shared/lib/canvas';

/**
 * Пути к арту арены — листовой модуль без зависимостей от движка (ревью #579;
 * из общего берётся только `whenDecoded`).
 *
 * Отдельно от `game-play.ts` намеренно: демо витрины нужен ровно один путь, а
 * импорт из `game-play` притаскивал бы в бандл `/design-system` весь класс
 * `GamePlay` с транзитивным графом (оружие, звук, реплеи, погода) и заводил
 * цикл «демо → движок боя». Общая константа исключает расхождение путей, не
 * платя за это весом.
 */
export const GAME_ASSET_PATHS = {
    sand: '/game/sand.jpg',
} as const;

let sandImagePromise: Promise<HTMLImageElement> | null = null;

/**
 * Текстура песка одним общим `Image` на модуль (ревью #579) — тем же приёмом, что
 * кеширует скины `loadTankSkinImages`.
 *
 * Создавать `new Image()` внутри эффекта компонента было дорого не запросами (их
 * схлопывает HTTP-кеш), а объектами и декодированием: секция витрины рисует семь
 * кадров, и каждый заводил свой `Image` — заново при любой смене ветра, скина или dpr.
 *
 * Промис резолвится и на `error`: битая текстура — не повод не нарисовать сцену,
 * `Ground` рисует по ней заливкой (как и до кеша).
 */
export function loadSandImage(): Promise<HTMLImageElement> {
    sandImagePromise ??= new Promise<HTMLImageElement>((resolve) => {
        const img = new Image();
        // Резолвим после decode: `load` — это «байты пришли», а не «кадр готов»
        // (`whenDecoded`). Текстура уходит в паттерн террейна, поэтому промах
        // декодирования тут стоил бы не одного кадра, а всей заливки земли.
        img.onload = () => void whenDecoded(img).then(resolve);
        img.onerror = () => resolve(img);
        img.src = GAME_ASSET_PATHS.sand;
    });
    return sandImagePromise;
}
