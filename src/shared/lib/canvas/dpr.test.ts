import { getDevicePixelRatio, toDevicePixels } from './dpr';

describe('toDevicePixels', () => {
    it('масштабирует CSS-размер на dpr для retina (dpr > 1)', () => {
        expect(toDevicePixels(300, 2)).toBe(600);
        expect(toDevicePixels(375, 3)).toBe(1125);
    });

    it('на обычном экране (dpr = 1) размер не меняется', () => {
        expect(toDevicePixels(100, 1)).toBe(100);
    });

    it('округляет дробный результат до целого пикселя', () => {
        // 333 * 1.5 = 499.5 → 500
        expect(toDevicePixels(333, 1.5)).toBe(500);
    });

    it('нулевой размер даёт ноль', () => {
        expect(toDevicePixels(0, 2)).toBe(0);
    });
});

describe('getDevicePixelRatio', () => {
    const original = window.devicePixelRatio;

    afterEach(() => {
        Object.defineProperty(window, 'devicePixelRatio', {
            configurable: true,
            value: original,
        });
    });

    it('возвращает значение window.devicePixelRatio, когда оно валидно', () => {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
        expect(getDevicePixelRatio()).toBe(2);
    });

    it('падает на 1, если devicePixelRatio равен 0 или не задан', () => {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 });
        expect(getDevicePixelRatio()).toBe(1);
    });
});
