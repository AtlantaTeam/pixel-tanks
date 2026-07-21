// Node-модуль отправки уведомлений в Telegram (бот → человек), issue #85.
//
// Односторонний канал: только исходящий sendMessage, без обработки апдейтов от
// бота. Токен и chat_id — СТРОГО из env (RALPH_TG_BOT_TOKEN / RALPH_TG_CHAT_ID),
// не из ralph.config.json и не из репозитория: конфиг коммитится в гит, история
// которого публичная и необратимая — секрету там не место (см. provision/ralph.env.example,
// тот же паттерн, что и GH_TOKEN/CLAUDE_CODE_OAUTH_TOKEN).
//
// Вызов Telegram Bot API — curl через execFileSync (argv-массив), тот же anti-RCE
// паттерн, что и probeEgress/restartTunnel в ralph.js (#92/#98): текст сообщения
// приходит из данных, которые пишет кто угодно (заголовок issue с публичного
// GitHub), --data-urlencode кодирует его без участия шелла. parse_mode сознательно
// не задаём: Markdown/HTML-режимы Telegram требуют экранирования спецсимволов в
// тексте — без этого сообщение с "непарной" звёздочкой или скобкой просто не
// отправится (400 Bad Request), а разбирать это экранирование ради уведомлений не
// стоит своих рисков.
//
// Fail-open: sendTelegramMessage никогда не бросает наружу — сбой (нет токена/
// chat_id, сеть, rate-limit или отказ Telegram API) не должен ронять loop раннера,
// только не долетает уведомление. Возвращает boolean успеха.

const { execFileSync } = require('node:child_process');

const TELEGRAM_API_BASE = 'https://api.telegram.org';

// Тот же предохранитель, что #138 в ralph.js (см. комментарий там), но свой
// журнал: модуль самостоятельный, require('./ralph.js') отсюда создал бы
// циклическую зависимость, как только ralph.js подключит этот модуль в pushEvent
// (#86). test-setup.js сверяет журналы обоих модулей в одном afterEach.
const NO_SIDE_EFFECTS = process.env.RALPH_NO_SIDE_EFFECTS === '1';
const sideEffectAttempts = [];

function guardSideEffect(what) {
    if (!NO_SIDE_EFFECTS) return;
    sideEffectAttempts.push(what);
    throw new Error(
        `${what} — побочка в тестовом окружении (RALPH_NO_SIDE_EFFECTS=1).\n` +
            'Подмени execFn в опциях sendTelegramMessage.',
    );
}

function realExecFn(...args) {
    guardSideEffect(`telegram execFileSync(${args[0]})`);
    return execFileSync(...args);
}

// Читает секреты строго из env — ralph.config.json коммитится в гит, там
// токену/chat_id не место.
function telegramConfigFromEnv() {
    return {
        token: (process.env.RALPH_TG_BOT_TOKEN || '').trim(),
        chatId: (process.env.RALPH_TG_CHAT_ID || '').trim(),
    };
}

// execFn инжектируется (как probeEgress/restartTunnel в ralph.js) — юнит-тесты
// мокают сам вызов curl, не реальную сеть/токен. logFn — куда пишутся
// предупреждения о недоставке; по умолчанию no-op, модуль не обязан знать про
// ralph.log (вызывающий код передаёт свой log()).
function sendTelegramMessage(text, { token, chatId, execFn = realExecFn, logFn = () => {} } = {}) {
    const envCfg = telegramConfigFromEnv();
    const finalToken = token ?? envCfg.token;
    const finalChatId = chatId ?? envCfg.chatId;

    if (!finalToken || !finalChatId) {
        logFn(
            '⚠ Telegram-нотифаер: не заданы RALPH_TG_BOT_TOKEN/RALPH_TG_CHAT_ID — сообщение не отправлено.',
        );
        return false;
    }

    const url = `${TELEGRAM_API_BASE}/bot${finalToken}/sendMessage`;
    try {
        const raw = execFn(
            'curl',
            [
                '-s',
                '--max-time',
                '10',
                '-X',
                'POST',
                url,
                '--data-urlencode',
                `chat_id=${finalChatId}`,
                '--data-urlencode',
                `text=${text}`,
            ],
            { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
        );

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            logFn(
                `⚠ Telegram-нотифаер: не удалось разобрать ответ API — ${String(raw).slice(0, 200)}`,
            );
            return false;
        }
        if (!parsed.ok) {
            logFn(
                `⚠ Telegram-нотифаер: API отклонил сообщение — ${parsed.description || 'без описания'}`,
            );
            return false;
        }
        return true;
    } catch (e) {
        logFn(`⚠ Telegram-нотифаер: отправка не удалась — ${String(e.message).split('\n')[0]}`);
        return false;
    }
}

module.exports = {
    sendTelegramMessage,
    telegramConfigFromEnv,
    TELEGRAM_API_BASE,
    sideEffectAttempts,
};
