#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #185 (Изоляция ralph · Фаза 3): фикстура npm-зависимости с lifecycle-скриптом.
//
// Сценарий PRD (docs/ralph-isolation/prd.md, «Пользовательские сценарии»): скомпро-
// метированная npm-зависимость исполняет postinstall при `npm ci` в гейте. Эта фикстура
// эмулирует ровно такую зависимость: её postinstall (postinstall.mjs) применяет ТОТ ЖЕ
// канареечный подход, что и scripts/secret-canary.mjs (env-переменные + известные файловые
// пути токенов) и печатает воспроизводимый отчёт, какие каналы к секретам петли открыты
// изнутри lifecycle-скрипта npm.
//
// Почему детект здесь ДУБЛИРУЕТ secret-canary.mjs, а не импортирует его: настоящая
// скомпрометированная зависимость самодостаточна — npm копирует её в node_modules,
// импорт `../secret-canary.mjs` (за пределы каталога пакета) после копирования сломался бы
// и уронил postinstall ненулевым кодом, а это нарушило бы критерий «фикстура не ломает
// обычный `npm ci`». Поэтому probe.mjs не тянет ничего за пределы своего каталога. Чтобы
// два списка каналов не разъезжались, их синхронность закреплена тестом-барьером
// (scripts/canary-postinstall-fixture.test.js сверяет определения с secret-canary.mjs).
//
// Логика детекта — чистые функции с DI (env, readFileFn, homedir): их гоняет обычный
// vitest на ФИКСТУРАХ, а не на живых секретах. Живой скан — только в postinstall.mjs.

// Те же семейства секретов, что ищет secret-canary.mjs (#184): реальные имена раннера
// (GH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, RALPH_TG_BOT_TOKEN — инвариант 11 CLAUDE.md) плюс
// алиасы (GITHUB_TOKEN/ANTHROPIC_API_KEY/TG_BOT_TOKEN): санация делается allowlist-ом,
// поэтому проверять надо ШИРЕ, чем чистим.
export const SECRET_ENV_VARS = [
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'TG_BOT_TOKEN',
    'RALPH_TG_BOT_TOKEN',
];

// Те же файловые каналы, что у secret-canary.mjs: токен gh CLI (env ИЛИ hosts.yml — PRD,
// «Технические ограничения»), токен claude CLI, env-файл секретов раннера. markers — ключи,
// наличие которых означает, что файл реально несёт секрет (читаемости мало, важно
// содержимое).
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

// Значение секрета в отчёт не пишем НИКОГДА — только факт наличия и длину (её мало, чтобы
// восстановить токен, и её достаточно, чтобы отличить реальный секрет от пустой строки).
export function redact(value) {
    if (value === undefined || value === null || value === '') return '<пусто>';
    return `<найден, длина ${String(value).length}>`;
}

// Раскрытие ведущего ~ в домашний каталог. homedir инжектируется — тест не зависит от
// os.homedir() машины.
export function expandHome(p, homedir) {
    if (p === '~') return homedir;
    if (p.startsWith('~/')) return path.join(homedir, p.slice(2));
    return p;
}

// Попытка достать секреты из окружения lifecycle-скрипта. Канал открыт, только если
// значение — непустая строка (наличие ключа с пустым значением секретом не является).
export function scanEnvChannels(env, secretVars = SECRET_ENV_VARS) {
    return secretVars.map((name) => {
        const value = env[name];
        const open = typeof value === 'string' && value.length > 0;
        return { channel: `env:${name}`, open, detail: open ? redact(value) : '<пусто>' };
    });
}

// Попытка достать секреты из известных файлов. Нечитаемый файл (ENOENT/EACCES) — канал
// закрыт (это и есть цель изоляции). Читаемый файл без секрет-маркеров — тоже закрыт
// (важно содержимое, а не факт чтения). Значение токена в отчёт не попадает.
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
export function buildReport({ env, readFileFn, homedir, secretVars, fileChannels } = {}) {
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

// Воспроизводимый человекочитаемый отчёт: детерминирован по входу, значений секретов не
// содержит. Заголовок помечает канал как postinstall — чтобы в общем логе отличать находку
// lifecycle-скрипта от обычной канарейки (secret-canary.mjs).
export function formatReport(report) {
    const lines = report.channels.map((c) => {
        const mark = c.open ? '🔓 ОТКРЫТ' : '🔒 закрыт';
        const label = c.label ? ` (${c.label})` : '';
        return `  ${mark}  ${c.channel}${label}: ${c.detail}`;
    });
    return [
        `Postinstall-канарейка (npm lifecycle-скрипт) — открытые каналы к секретам петли: ${report.openCount}/${report.total}`,
        ...lines,
    ].join('\n');
}

// Живой скан текущего окружения и файлов. Вынесен в функцию, чтобы postinstall.mjs остался
// тонкой обёрткой; readFileFn/homedir/env инжектируемы для тестируемости.
export function runProbe({
    env = process.env,
    readFileFn = readFileSync,
    homedir = os.homedir(),
} = {}) {
    return buildReport({ env, readFileFn, homedir });
}

function main() {
    console.log(formatReport(runProbe()));
    process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
