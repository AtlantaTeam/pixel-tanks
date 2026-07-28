// Юнит-тесты общего util-модуля (#232): shq/positiveIntOrDefault/sleep — раньше жили
// копиями в ralph.js и telegram-notifier.js, теперь единственный источник правды.
// Здесь же живут anti-injection round-trip-тесты shq (через реальный /bin/sh) и полный
// негативный набор positiveIntOrDefault (#132) — тесты рядом с модулем, который они
// покрывают; ralph.test.js держит лишь смоук ре-экспорта (тот же объект).
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
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

// Главный сценарий anti-injection (#133): значение из конфига/GitHub уходит в sh() и
// НЕ должно исполниться. Проверяем на живом шелле, а не сверкой строк — иначе тест
// доказывает лишь мои представления о квотировании, а не поведение /bin/sh.
describe('shq — round-trip через реальный /bin/sh (#133)', () => {
    it.each([
        ['подстановка команды', '$(echo ВЗЛОМ)'],
        ['обратные кавычки', '`echo ВЗЛОМ`'],
        ['разделитель команд', '; echo ВЗЛОМ'],
        ['переменная', '$HOME'],
        ['кавычка и подстановка', `'; echo ВЗЛОМ; echo '`],
    ])('%s проходит через шелл дословно', (_name, payload) => {
        const out = execSync(`printf '%s' ${shq(payload)}`, { encoding: 'utf-8' });
        // Дословно = payload вернулся как есть. Если бы шелл его ИСПОЛНИЛ, на выходе
        // было бы 'ВЗЛОМ' (или подставленный $HOME) вместо самой строки.
        expect(out).toBe(payload);
        expect(out.trim()).not.toBe('ВЗЛОМ');
    });

    it('кириллица и типографика milestone переживают квотирование дословно', () => {
        const milestone = 'Прод-режим ralph · Фаза 4: Толстый гейт (prod)';
        const out = execSync(`printf '%s' ${shq(milestone)}`, { encoding: 'utf-8' });
        expect(out).toBe(milestone);
    });
});

describe('positiveIntOrDefault — бюджет ходов (#132)', () => {
    it('нормальное значение проходит', () => {
        expect(positiveIntOrDefault(80, 200)).toBe(80);
    });

    // 0 — не «без ограничения», а бюджет без единого хода/попытки; строка '80' из
    // JSON-конфига — опечатка, а не «странное число», Number('80') тихо простил бы её.
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
        // Atomics.wait по спецификации не возвращается раньше таймаута — слоп бывает
        // только вверх, поэтому порог равен запрошенному значению, а не ослаблен.
        expect(performance.now() - start).toBeGreaterThanOrEqual(20);
    });

    // NaN-таймаут Atomics.wait трактует как +∞ — вечный сон посреди прогона. Мусорный
    // ms должен вернуться мгновенно, а не подвесить раннер.
    it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['-Infinity', -Infinity],
        ['отрицательное', -100],
    ])('%s → мгновенный возврат, без вечного сна', (_name, value) => {
        const start = performance.now();
        sleep(value);
        expect(performance.now() - start).toBeLessThan(50);
    });
});
