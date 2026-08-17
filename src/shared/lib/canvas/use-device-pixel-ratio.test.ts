import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDevicePixelRatio } from './use-device-pixel-ratio';

type TListener = () => void;

/** Стаб `matchMedia`, отдающий последний навешенный слушатель `change`. */
function mockMatchMedia(): { fireChange: () => void; queries: string[]; restore: () => void } {
    const original = window.matchMedia;
    const listeners: TListener[] = [];
    const queries: string[] = [];

    window.matchMedia = vi.fn((query: string) => {
        queries.push(query);
        return {
            matches: true,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: (_: string, listener: TListener) => listeners.push(listener),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        } as unknown as MediaQueryList;
    });

    return {
        queries,
        fireChange: () => listeners.at(-1)?.(),
        restore: () => {
            window.matchMedia = original;
        },
    };
}

function setDevicePixelRatio(value: number) {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value });
}

describe('useDevicePixelRatio', () => {
    const originalDpr = window.devicePixelRatio;

    afterEach(() => {
        setDevicePixelRatio(originalDpr);
        vi.restoreAllMocks();
    });

    it('отдаёт текущий devicePixelRatio', () => {
        setDevicePixelRatio(2);
        const media = mockMatchMedia();

        const { result } = renderHook(() => useDevicePixelRatio());

        expect(result.current).toBe(2);
        expect(media.queries.at(-1)).toBe('(resolution: 2dppx)');
        media.restore();
    });

    it('подхватывает смену плотности — окно уехало на монитор с другим dpr', () => {
        setDevicePixelRatio(1);
        const media = mockMatchMedia();
        const { result } = renderHook(() => useDevicePixelRatio());
        expect(result.current).toBe(1);

        setDevicePixelRatio(3);
        act(() => media.fireChange());

        // Значение обновилось И запрос пересоздан под новое: иначе следующая смена
        // плотности прошла бы мимо — старый запрос совпадать уже не перестанет.
        expect(result.current).toBe(3);
        expect(media.queries.at(-1)).toBe('(resolution: 3dppx)');
        media.restore();
    });

    it('без matchMedia (SSR-подобная среда) не падает и отдаёт дефолт', () => {
        setDevicePixelRatio(0);
        const original = window.matchMedia;
        // @ts-expect-error — намеренно снимаем API, как в старых браузерах.
        window.matchMedia = undefined;

        const { result } = renderHook(() => useDevicePixelRatio());

        expect(result.current).toBe(1);
        window.matchMedia = original;
    });
});
