import { describe, expect, it, vi } from 'vitest';
import { whenDecoded } from './decode-image';

/** Минимальный дубль `HTMLImageElement` — нужен только `decode`. */
const imageWith = (decode?: unknown) => ({ decode, width: 10 }) as unknown as HTMLImageElement;

describe('whenDecoded', () => {
    it('отдаёт картинку после успешного decode', async () => {
        const decode = vi.fn(() => Promise.resolve());
        const image = imageWith(decode);

        await expect(whenDecoded(image)).resolves.toBe(image);
        expect(decode).toHaveBeenCalledTimes(1);
    });

    it('не ждёт decode, когда его нет в среде (happy-dom/SSR)', async () => {
        const image = imageWith(undefined);

        await expect(whenDecoded(image)).resolves.toBe(image);
    });

    it('резолвится той же картинкой, когда decode отказал (битый файл)', async () => {
        const image = imageWith(() => Promise.reject(new Error('broken')));

        await expect(whenDecoded(image)).resolves.toBe(image);
    });

    it('ждёт завершения decode, а не только его вызова', async () => {
        let release: (() => void) | undefined;
        const image = imageWith(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
        );
        const settled = vi.fn();

        void whenDecoded(image).then(settled);
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();

        release?.();
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toHaveBeenCalledWith(image);
    });
});
