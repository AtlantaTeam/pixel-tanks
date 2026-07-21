// Юнит-тесты telegram-notifier.js (#85). execFn всегда мокается явно — реальный
// curl запрещён в тестовом окружении (RALPH_NO_SIDE_EFFECTS=1, см. test-setup.js);
// забытый мок ловит общий afterEach через sideEffectAttempts, а не тихо бьёт в сеть.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    sendTelegramMessage,
    telegramConfigFromEnv,
    TELEGRAM_API_BASE,
} from './telegram-notifier.js';

describe('telegramConfigFromEnv', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('читает token/chatId из RALPH_TG_BOT_TOKEN и RALPH_TG_CHAT_ID', () => {
        process.env.RALPH_TG_BOT_TOKEN = '123:abc';
        process.env.RALPH_TG_CHAT_ID = '42';
        expect(telegramConfigFromEnv()).toEqual({ token: '123:abc', chatId: '42' });
    });

    it('возвращает пустые строки, если переменные не заданы', () => {
        delete process.env.RALPH_TG_BOT_TOKEN;
        delete process.env.RALPH_TG_CHAT_ID;
        expect(telegramConfigFromEnv()).toEqual({ token: '', chatId: '' });
    });

    it('обрезает пробелы/переводы строк (копипаста в env-файл)', () => {
        process.env.RALPH_TG_BOT_TOKEN = ' 123:abc \r\n';
        process.env.RALPH_TG_CHAT_ID = ' 42 ';
        expect(telegramConfigFromEnv()).toEqual({ token: '123:abc', chatId: '42' });
    });
});

describe('sendTelegramMessage', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        delete process.env.RALPH_TG_BOT_TOKEN;
        delete process.env.RALPH_TG_CHAT_ID;
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('шлёт сообщение в заданный chat_id через execFn', () => {
        const execFn = vi.fn().mockReturnValue(JSON.stringify({ ok: true }));

        const result = sendTelegramMessage('Фаза готова к релизу', {
            token: 'TOKEN123',
            chatId: 'CHAT456',
            execFn,
        });

        expect(result).toBe(true);
        expect(execFn).toHaveBeenCalledTimes(1);
        const [bin, args] = execFn.mock.calls[0];
        expect(bin).toBe('curl');
        expect(args).toContain(`${TELEGRAM_API_BASE}/botTOKEN123/sendMessage`);
        expect(args).toContain('chat_id=CHAT456');
        expect(args).toContain('text=Фаза готова к релизу');
    });

    it('берёт token/chatId из env, если не переданы параметром', () => {
        process.env.RALPH_TG_BOT_TOKEN = 'ENVTOKEN';
        process.env.RALPH_TG_CHAT_ID = 'ENVCHAT';
        const execFn = vi.fn().mockReturnValue(JSON.stringify({ ok: true }));

        const result = sendTelegramMessage('привет', { execFn });

        expect(result).toBe(true);
        expect(execFn.mock.calls[0][1]).toContain(`${TELEGRAM_API_BASE}/botENVTOKEN/sendMessage`);
        expect(execFn.mock.calls[0][1]).toContain('chat_id=ENVCHAT');
    });

    it('явные token/chatId параметра важнее env (не молчаливая подмена)', () => {
        process.env.RALPH_TG_BOT_TOKEN = 'ENVTOKEN';
        process.env.RALPH_TG_CHAT_ID = 'ENVCHAT';
        const execFn = vi.fn().mockReturnValue(JSON.stringify({ ok: true }));

        sendTelegramMessage('hi', { token: 'EXPLICIT', chatId: 'EXPLICITCHAT', execFn });

        expect(execFn.mock.calls[0][1]).toContain(`${TELEGRAM_API_BASE}/botEXPLICIT/sendMessage`);
        expect(execFn.mock.calls[0][1]).toContain('chat_id=EXPLICITCHAT');
    });

    it('fail-open: не бросает и возвращает false, если нет token/chatId', () => {
        const execFn = vi.fn();
        const logFn = vi.fn();

        const result = sendTelegramMessage('событие', { execFn, logFn });

        expect(result).toBe(false);
        expect(execFn).not.toHaveBeenCalled();
        expect(logFn).toHaveBeenCalledWith(expect.stringContaining('RALPH_TG_BOT_TOKEN'));
    });

    it('fail-open: не бросает и возвращает false, если execFn упал (сеть/curl)', () => {
        const execFn = vi.fn().mockImplementation(() => {
            throw new Error('curl: (28) Connection timed out');
        });
        const logFn = vi.fn();

        expect(() =>
            sendTelegramMessage('событие', { token: 'T', chatId: 'C', execFn, logFn }),
        ).not.toThrow();
        const result = sendTelegramMessage('событие', { token: 'T', chatId: 'C', execFn, logFn });

        expect(result).toBe(false);
        expect(logFn).toHaveBeenCalledWith(expect.stringContaining('отправка не удалась'));
    });

    it('fail-open: false и лог, если Telegram API отклонил сообщение (ok:false)', () => {
        const execFn = vi
            .fn()
            .mockReturnValue(JSON.stringify({ ok: false, description: 'chat not found' }));
        const logFn = vi.fn();

        const result = sendTelegramMessage('событие', { token: 'T', chatId: 'C', execFn, logFn });

        expect(result).toBe(false);
        expect(logFn).toHaveBeenCalledWith(expect.stringContaining('chat not found'));
    });

    it('fail-open: false и лог, если ответ не парсится как JSON', () => {
        const execFn = vi.fn().mockReturnValue('<html>502 Bad Gateway</html>');
        const logFn = vi.fn();

        const result = sendTelegramMessage('событие', { token: 'T', chatId: 'C', execFn, logFn });

        expect(result).toBe(false);
        expect(logFn).toHaveBeenCalledWith(expect.stringContaining('не удалось разобрать ответ'));
    });
});
