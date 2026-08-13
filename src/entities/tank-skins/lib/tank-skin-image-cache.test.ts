import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTankSkinImages, resetTankSkinImageCache } from './tank-skin-image-cache';

let createdCount = 0;

class CountingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = '';

    constructor() {
        createdCount += 1;
    }

    set src(value: string) {
        this._src = value;
        // Синхронная имитация загрузки — happy-dom не декодирует data:URL сам.
        queueMicrotask(() => this.onload?.());
    }

    get src() {
        return this._src;
    }
}

beforeEach(() => {
    createdCount = 0;
    resetTankSkinImageCache();
    vi.stubGlobal('Image', CountingImage);
});

afterEach(() => {
    vi.unstubAllGlobals();
    resetTankSkinImageCache();
});

describe('loadTankSkinImages — кэш отрисовки (issue #481)', () => {
    it('на новый skinId создаёт ровно два Image (корпус + ствол)', async () => {
        await loadTankSkinImages('classic-verdant');
        expect(createdCount).toBe(2);
    });

    it('повторный вызов с тем же skinId не пересобирает Image', async () => {
        const first = await loadTankSkinImages('classic-verdant');
        const countAfterFirst = createdCount;

        const second = await loadTankSkinImages('classic-verdant');

        expect(createdCount).toBe(countAfterFirst);
        expect(second.hull).toBe(first.hull);
        expect(second.barrel).toBe(first.barrel);
    });

    it('параллельные вызовы одним тиком тоже не дублируют Image (одна запись кэша на ключ)', async () => {
        const [a, b] = await Promise.all([
            loadTankSkinImages('heavy-amber'),
            loadTankSkinImages('heavy-amber'),
        ]);

        expect(createdCount).toBe(2);
        expect(a.hull).toBe(b.hull);
    });

    it('разные skinId создают отдельные записи кэша', async () => {
        await loadTankSkinImages('classic-verdant');
        await loadTankSkinImages('heavy-crimson');

        expect(createdCount).toBe(4);
    });

    it('падает fail-closed на неизвестном skinId', () => {
        expect(() =>
            // @ts-expect-error — намеренно битый id
            loadTankSkinImages('unknown-skin'),
        ).toThrow(/Неизвестный скин/);
    });
});
