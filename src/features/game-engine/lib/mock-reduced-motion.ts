import { vi } from 'vitest';

/**
 * Тест-хелпер: мокает `window.matchMedia` так, чтобы запрос
 * `(prefers-reduced-motion: reduce)` отвечал заданным `matches`.
 * Возвращает функцию восстановления оригинального `matchMedia`.
 *
 * Каст к `MediaQueryList` живёт здесь, в одном месте, — тесты движка (CameraShake,
 * SlowMotion) переиспользуют хелпер и не дублируют мок с `as any`.
 */
export function mockReducedMotion(matches: boolean): () => void {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(
        (query: string) =>
            ({
                matches,
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }) as unknown as MediaQueryList,
    );
    return () => {
        window.matchMedia = original;
    };
}
