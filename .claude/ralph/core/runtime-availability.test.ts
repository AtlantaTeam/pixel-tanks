// Юнит-тесты модуля детекции/ожидания транзиентной недоступности рантайма (#606). Здесь
// проверяется САМ модуль runtime-availability.ts — чистые преобразования вход→выход, без
// orchestrator.ts: retry-цикл внутри runClaude покрыт своими тестами в orchestrator.test.ts.
import { describe, it, expect } from 'vitest';
import {
    RUNTIME_UNAVAILABLE_RE,
    isRuntimeUnavailable,
    runtimeUnavailableWaitMs,
    runtimeUnavailableMessage,
    runtimeUnavailableExhaustedMessage,
    DEFAULT_RUNTIME_UNAVAILABLE_MAX_WAIT_MS,
    DEFAULT_RUNTIME_UNAVAILABLE_RETRY_DELAY_MS,
} from './runtime-availability.ts';

describe('isRuntimeUnavailable — детекция транзиентной недоступности CLI', () => {
    it.each([
        [127, ''],
        [127, 'что угодно'],
        [1, '/usr/local/bin/claude: line 70: /usr/bin/claude: No such file or directory'],
        [1, 'spawn claude ENOENT'],
        [1, 'bash: claude: ENOENT'],
    ])('код %i, вывод "%s" → транзиент', (code, output) => {
        expect(isRuntimeUnavailable(code, output)).toBe(true);
    });

    it.each([
        [1, 'просто упало'],
        [1, 'Error: тест не прошёл, ожидали 3 получили 4'],
        [1, ''],
        [2, 'permission denied'],
    ])('код %i, вывод "%s" → НЕ транзиент (настоящий крах сессии)', (code, output) => {
        expect(isRuntimeUnavailable(code, output)).toBe(false);
    });

    it('RUNTIME_UNAVAILABLE_RE не матчит осмысленный вывод модели', () => {
        expect(RUNTIME_UNAVAILABLE_RE.test('Все тесты прошли, PR готов к ревью')).toBe(false);
    });
});

describe('runtimeUnavailableWaitMs — линейный backoff', () => {
    it('растёт линейно от базы (дефолт 10с)', () => {
        expect(runtimeUnavailableWaitMs(1)).toBe(10_000);
        expect(runtimeUnavailableWaitMs(2)).toBe(20_000);
        expect(runtimeUnavailableWaitMs(3)).toBe(30_000);
    });

    it('уважает cfg.runtimeUnavailableRetryDelayMs', () => {
        expect(runtimeUnavailableWaitMs(2, { runtimeUnavailableRetryDelayMs: 1000 })).toBe(2000);
    });

    it('мусорное значение конфига откатывается на дефолт', () => {
        expect(
            runtimeUnavailableWaitMs(1, {
                runtimeUnavailableRetryDelayMs: -5 as unknown as number,
            }),
        ).toBe(DEFAULT_RUNTIME_UNAVAILABLE_RETRY_DELAY_MS);
    });
});

describe('тексты сообщений — формулировка причины', () => {
    it('runtimeUnavailableMessage называет код и попытку', () => {
        const msg = runtimeUnavailableMessage(2, 20_000, 127);
        expect(msg).toMatch(/код 127/);
        expect(msg).toMatch(/попытка 2/);
        expect(msg).toMatch(/20с/);
    });

    it('runtimeUnavailableExhaustedMessage прямо называет причину «рантайм недоступен», не «вердикта не было»', () => {
        const msg = runtimeUnavailableExhaustedMessage(DEFAULT_RUNTIME_UNAVAILABLE_MAX_WAIT_MS, 7);
        expect(msg).toMatch(/рантайм недоступен/);
        expect(msg).toMatch(/5 мин/);
        expect(msg).toMatch(/7 повторов/);
        expect(msg).not.toMatch(/вердикт/);
    });
});
