#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #184 (Изоляция ralph · Фаза 3): позитивная канареечная проверка границы изоляции.
//
// Канарейка ПЫТАЕТСЯ достать секреты петли всеми известными путями (env-переменные и
// известные файловые пути токенов) и печатает воспроизводимый отчёт, КАКИЕ каналы к
// секретам сейчас открыты. Смысл — сделать «изолировано» проверяемым фактом, а не верой:
// без неё «мы почистили env» нельзя отличить от «токен пришёл другим путём» (PRD
// docs/ralph-isolation/prd.md, скоуп п. 2).
//
// На ЭТОЙ фазе канарейка — ОТДЕЛЬНЫЙ РУЧНОЙ скрипт (`npm run canary:secrets`), в гейт она
// НЕ встраивается и НЕ краснит: до env-санации (фаза 4, #190) это был бы вечно-зелёный
// чек, который находит секреты и молчит, — против fail-closed-духа обоих PRD. Красным
// обязательным чеком гейта канарейка становится в фазе 4. Поэтому main() всегда exit 0:
// это ИЗМЕРЕНИЕ, а не красный гейт (docs/ralph-isolation/plan.md, фаза 3 + уточнение по
// ревью в #184).
//
// Логика детекта вынесена в чистые функции с DI (env, readFileFn, homedir) — их гоняет
// обычный vitest-тест (secret-canary.test.js) на ФИКСТУРАХ, а не на живых секретах:
// так тест зелёный в гейте и ничего не утаскивает. Живой скан — только в main().

// Секреты, которые петля держит в окружении (инвариант 11 CLAUDE.md): реальные имена
// раннера — GH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, RALPH_TG_BOT_TOKEN. Алиасы (GITHUB_TOKEN,
// ANTHROPIC_API_KEY, TG_BOT_TOKEN) — под ними тот же секрет мог прийти иным путём: PRD
// требует санацию allowlist-ом, канарейка же ищет ШИРЕ (по семействам GH_*/CLAUDE_*/
// ANTHROPIC*/TG_*), иначе «почистили GH_TOKEN» нельзя отличить от «утёк GITHUB_TOKEN».
export const SECRET_ENV_VARS = [
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'TG_BOT_TOKEN',
    'RALPH_TG_BOT_TOKEN',
];

// Файловые каналы к тем же секретам. gh CLI берёт токен из env ИЛИ из hosts.yml (PRD,
// «Технические ограничения») — фактический источник на VDS устанавливает #186; claude
// CLI хранит токен в credentials.json; сами секреты раннера лежат в env-файле
// /root/ralph.env (CLAUDE.md, «Обязательная внешняя инфраструктура»). markers — ключи,
// наличие которых означает, что файл реально несёт секрет: читаемости мало, важно
// содержимое (пустой конфиг без токена — не открытый канал).
export const SECRET_FILE_CHANNELS = [
    { path: '~/.config/gh/hosts.yml', label: 'gh CLI OAuth-токен', markers: ['oauth_token'] },
    {
        path: '~/.claude/.credentials.json',
        label: 'claude CLI OAuth-токен',
        markers: ['accessToken', 'refreshToken', 'oauth'],
    },
    {
        path: '/root/ralph.env',
        label: 'env-файл секретов раннера',
        markers: ['GH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'TG_BOT_TOKEN'],
    },
];

// Отчёт канарейки может попасть в research/логи — значение секрета в него не пишем
// НИКОГДА, только факт наличия и длину (её достаточно, чтобы отличить реальный токен от
// пустой строки, и сама по себе она не секрет).
export function redact(value) {
    if (value === undefined || value === null || value === '') return '<пусто>';
    return `<найден, длина ${String(value).length}>`;
}

// Раскрытие ведущего ~ в домашний каталог (~/x → <home>/x). Инжектируемый homedir —
// чтобы тест не зависел от os.homedir() машины.
export function expandHome(p, homedir) {
    if (p === '~') return homedir;
    if (p.startsWith('~/')) return path.join(homedir, p.slice(2));
    return p;
}

// Попытка достать секреты из окружения. Канал открыт, только если значение — непустая
// строка: наличие ключа с пустым значением секретом не является.
export function scanEnvChannels(env, secretVars = SECRET_ENV_VARS) {
    return secretVars.map((name) => {
        const value = env[name];
        const open = typeof value === 'string' && value.length > 0;
        return { channel: `env:${name}`, open, detail: open ? redact(value) : '<пусто>' };
    });
}

// Попытка достать секреты из известных файлов. Нечитаемый файл (ENOENT/EACCES) — канал
// закрыт (это и есть цель изоляции), код ошибки записываем в отчёт для воспроизводимости.
// Читаемый файл без секрет-маркеров — тоже закрыт: важно содержимое, а не сам факт
// чтения. Значение токена в отчёт не попадает — только имя сработавшего маркера.
export function scanFileChannels(readFileFn, homedir, channels = SECRET_FILE_CHANNELS) {
    return channels.map(({ path: p, label, markers }) => {
        const resolved = expandHome(p, homedir);
        let content;
        try {
            content = readFileFn(resolved, 'utf8');
        } catch (e) {
            const detail =
                e && e.code === 'ENOENT' ? '<нет файла>' : `<не читается: ${e?.code ?? 'ошибка'}>`;
            return { channel: `file:${p}`, label, open: false, detail };
        }
        const hit = markers.find((m) => content.includes(m));
        const open = hit !== undefined;
        return {
            channel: `file:${p}`,
            label,
            open,
            detail: open
                ? `<читается, найден маркер "${hit}", длина ${content.length}>`
                : '<читается, секрет-маркеров нет>',
        };
    });
}

// Сводный отчёт: список каналов (env + файлы) с флагом open и число открытых.
// env/readFileFn/homedir обязательны (это коллабораторы скана) — дефолта у объекта нет
// намеренно: вызов без аргументов — ошибка, а не «пустой отчёт».
export function buildReport({ env, readFileFn, homedir, secretVars, fileChannels }) {
    const channels = [
        ...scanEnvChannels(env, secretVars),
        ...scanFileChannels(readFileFn, homedir, fileChannels),
    ];
    return {
        channels,
        total: channels.length,
        openCount: channels.filter((c) => c.open).length,
    };
}

// Воспроизводимый человекочитаемый отчёт: детерминирован по входу (тот же env/файлы →
// тот же текст), значений секретов не содержит.
export function formatReport(report) {
    const lines = report.channels.map((c) => {
        const mark = c.open ? '🔓 ОТКРЫТ' : '🔒 закрыт';
        const label = c.label ? ` (${c.label})` : '';
        return `  ${mark}  ${c.channel}${label}: ${c.detail}`;
    });
    return [
        `Канарейка секретов — открытые каналы к секретам петли: ${report.openCount}/${report.total}`,
        ...lines,
    ].join('\n');
}

function main() {
    const report = buildReport({
        env: process.env,
        readFileFn: readFileSync,
        homedir: os.homedir(),
    });
    console.log(formatReport(report));
    // Фаза 3: измерение, а не красный гейт — естественное завершение даёт код 0 (см.
    // докблок выше). Явный process.exit(0) НЕ ставим: при пайп-выводе
    // (`npm run canary:secrets > snapshot.txt`, baseline #187) он не ждёт сброса stdout и
    // может обрезать отчёт. main() — последняя операция, так что exit 0 и без него.
    // Красным обязательным чеком канарейка становится в фазе 4 (#190).
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
