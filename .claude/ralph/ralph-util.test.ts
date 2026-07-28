// Юнит-тесты общего util-модуля (#232): shq/positiveIntOrDefault/sleep — раньше жили
// копиями в ralph.js и telegram-notifier.js, теперь единственный источник правды.
import { describe, expect, it } from 'vitest';
import { positiveIntOrDefault, shq, sleep } from './ralph-util.ts';

describe('shq', () => {
    it('оборачивает значение в одинарные кавычки', () => {
        expect(shq('feature/m1')).toBe("'feature/m1'");
    });

    it('экранирует одинарную кавычку внутри значения (close-escape-open)', () => {
        expect(shq("don't")).toBe("'don'\\''t'");
    });

    it('приводит нестроковые значения через String()', () => {
        expect(shq(42)).toBe("'42'");
    });
});

describe('positiveIntOrDefault — бюджет ходов (#132)', () => {
    it('нормальное значение проходит', () => {
        expect(positiveIntOrDefault(80, 200)).toBe(80);
    });

    it.each([
        ['ноль', 0],
        ['отрицательное', -1],
        ['дробное', 12.5],
        ['строка', '80'],
        ['undefined', undefined],
        ['null', null],
    ])('%s → дефолт', (_name, value) => {
        expect(positiveIntOrDefault(value, 200)).toBe(200);
    });
});

describe('sleep', () => {
    it('блокирует поток минимум на заданное время', () => {
        const start = performance.now();
        sleep(20);
        expect(performance.now() - start).toBeGreaterThanOrEqual(15);
    });
});
