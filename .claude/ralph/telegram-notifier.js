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

// Telegram режет sendMessage на 4096 символах: более длинный текст вернёт 400, и
// fail-open молча съест уведомление. Обрезаем заранее — заголовок issue в событии
// вполне может однажды перевалить лимит.
const TELEGRAM_MAX_TEXT = 4096;

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

    // Токен — секрет, а в argv он виден в `ps`/`/proc/*/cmdline` всё время запроса.
    // Прячем URL с токеном в curl-конфиг, который curl читает со stdin (--config -):
    // в argv остаются только флаги. chat_id/text — не секреты, оставляем их там же
    // через --data-urlencode (шелл не участвует, argv-массив). Токен бота имеет вид
    // `\d+:[A-Za-z0-9_-]+` — ни кавычек, ни бэкслэшей, поэтому значение в конфиге
    // безопасно взять в кавычки, а untrusted-текст в конфиг НЕ попадает (иначе `"`
    // из заголовка issue закрыл бы строку раньше времени).
    const url = `${TELEGRAM_API_BASE}/bot${finalToken}/sendMessage`;
    const curlConfig = `url = "${url}"\n`;
    // Режем по code points, а не по UTF-16-единицам: граница TELEGRAM_MAX_TEXT
    // может попасть в середину суррогатной пары (эмодзи 🔔/⛔/✅ в текстах пушей —
    // как раз пары), тогда в argv уехал бы одинокий суррогат → U+FFFD `�` в UTF-8.
    const safeText = [...String(text)].slice(0, TELEGRAM_MAX_TEXT).join('');
    try {
        const raw = execFn(
            'curl',
            [
                '-s',
                '--max-time',
                '10',
                // api.telegram.org из РФ доступен напрямую (разблокирован с 2020) —
                // ходить к нему через SS-туннель нельзя: событие «туннель красный»
                // стреляет ровно тогда, когда этот маршрут мёртв, и единственный пуш,
                // ради которого канал заведён, гарантированно не долетел бы. --noproxy
                // делает обход прокси безусловным, не завися от NO_PROXY в env.
                '--noproxy',
                'api.telegram.org',
                // -X POST не нужен: curl сам шлёт POST при любом --data-* (в т.ч.
                // --data-urlencode). Явный -X ещё и вреден при появлении редиректа —
                // заставил бы слать POST после 30x, где curl сам переключился бы верно.
                '--config',
                '-',
                '--data-urlencode',
                `chat_id=${finalChatId}`,
                '--data-urlencode',
                `text=${safeText}`,
            ],
            { encoding: 'utf-8', input: curlConfig, stdio: ['pipe', 'pipe', 'pipe'] },
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
        // execFileSync при непустом exit-коде кладёт ПЕРВОЙ строкой e.message всю
        // команду (`Command failed: curl …`). URL с токеном теперь уходит в stdin, а
        // не в argv, но редактируем на всякий случай: лог тейлится монитором и
        // копируется в чат — секрету там не место. Пустой токен сюда не доходит
        // (ранний return выше), поэтому replaceAll не схлопнет всю строку.
        const firstLine = String(e.message).split('\n')[0].replaceAll(finalToken, '***');
        logFn(`⚠ Telegram-нотифаер: отправка не удалась — ${firstLine}`);
        return false;
    }
}

module.exports = {
    sendTelegramMessage,
    telegramConfigFromEnv,
    TELEGRAM_API_BASE,
    sideEffectAttempts,
};
