import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_ASSET_PATHS, loadSandImage } from './game-assets';

/** Изображения, созданные `loadSandImage` за прогон файла. */
const created: { src: string; onload?: () => void; onerror?: () => void }[] = [];

class ImageStub {
    src = '';
    onload?: () => void;
    onerror?: () => void;

    constructor() {
        created.push(this);
    }
}

vi.stubGlobal('Image', ImageStub);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('GAME_ASSET_PATHS', () => {
    it('путь к песку один на все сцены — витрина и бой не могут разойтись', () => {
        expect(GAME_ASSET_PATHS.sand).toBe('/game/sand.jpg');
    });
});

describe('loadSandImage', () => {
    it('заводит ровно один Image на модуль и грузит путь из GAME_ASSET_PATHS', async () => {
        // Ревью #579: `new Image()` жил в эффекте компонента и создавался на каждый из
        // семи кадров секции витрины, заново при смене ветра/скина/dpr. Кеш — на модуле.
        const first = loadSandImage();
        const second = loadSandImage();

        expect(second).toBe(first);
        expect(created).toHaveLength(1);
        expect(created[0].src).toBe(GAME_ASSET_PATHS.sand);

        created[0].onload?.();
        await expect(first).resolves.toBe(created[0]);
    });

    it('не отдаёт текстуру, пока она не декодирована', async () => {
        // `load` — «байты пришли», а не «кадр готов»: `drawImage` сразу по load
        // может нарисовать пусто, а песок уходит в паттерн террейна.
        vi.resetModules();
        const { loadSandImage: freshLoad } = await import('./game-assets');
        const pending = freshLoad();
        const img = created.at(-1) as (typeof created)[number] & {
            decode: () => Promise<void>;
        };
        let finishDecode: (() => void) | undefined;
        img.decode = () =>
            new Promise<void>((resolve) => {
                finishDecode = resolve;
            });
        const settled = vi.fn();
        void pending.then(settled);

        img.onload?.();
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();

        finishDecode?.();
        await expect(pending).resolves.toBe(img);
    });

    it('битая текстура не роняет сцену — промис резолвится и на ошибке', async () => {
        // Кадр без песка рисуется заливкой `Ground`; висящий промис остановил бы отрисовку.
        vi.resetModules();
        const { loadSandImage: freshLoad } = await import('./game-assets');
        const pending = freshLoad();
        const img = created.at(-1);
        expect(img).toBeDefined();

        img?.onerror?.();

        await expect(pending).resolves.toBe(img);
    });
});
