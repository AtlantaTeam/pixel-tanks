#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { SECRET_FILE_CHANNELS, buildReport, formatReport } from './secret-canary.mjs';

// #190 (Изоляция ralph · Фаза 4): канарейка секретов становится ОБЯЗАТЕЛЬНЫМ красным
// чеком гейта.
//
// secret-canary.mjs (фаза 3, #184) остаётся РУЧНЫМ измерением (`npm run canary:secrets`)
// с вечным exit 0 — его докблок объясняет, зачем: это baseline-снятие
// (`canary:secrets > snapshot.txt`), а не гейт. Эта обёртка — отдельный скрипт для
// гейта, на ТОЙ ЖЕ логике детекта (buildReport/scanEnvChannels/scanFileChannels),
// с вердиктом зелёный/красный вместо голого отчёта.
//
// ПОЧЕМУ "любой открытый канал = красный" НЕ подходит. Env-санация (#188/#189) закрывает
// ТОЛЬКО env-канал; файловый канал (~/.claude/.credentials.json, /root/ralph.env — тот же
// пользователь ОС) остаётся открытым до толстой границы (б)/(в) — это задокументированный
// ОСТАТОЧНЫЙ РИСК (#192), не брак этой фазы (PRD docs/ralph-isolation/prd.md, скоуп п. 2).
// Красный чек на КАЖДЫЙ прогон гейта из-за уже принятого риска обесценил бы "красный" —
// научил бы его игнорировать. Поэтому вердикт сверяет открытые каналы с явным списком
// ПРИНЯТОГО риска (RESIDUAL_RISK_CHANNELS — файловые каналы secret-canary.mjs): открыт
// канал СВЕРХ этого списка (в первую очередь любой env:*, который санация обязана
// закрыть, либо новый файловый канал) — это утечка, гейт краснеет.
//
// РАЗЛИЧИЕ СООБЩЕНИЙ (критерий готовности #190). Красный этого чека всегда говорит
// "СЕКРЕТ НАЙДЕН" — фиксированной строкой, отдельной от любого другого красного чека
// гейта. Если санация вычистила переменную, нужную ДРУГОМУ легитимному чеку
// (build/lint/test), тот чек падает СВОИМ сообщением инструмента ("module not found",
// "X is not defined" и т.п.) — это отдельный класс отказа ("переменная не в allowlist",
// чинится добавлением в .claude/ralph/gate-env-allowlist.json), и его нельзя спутать с
// находкой канарейки именно потому, что канарейка — отдельный чек с этим текстом.

export const RESIDUAL_RISK_CHANNELS = new Set(SECRET_FILE_CHANNELS.map((c) => `file:${c.path}`));

// Разбирает отчёт canary на принятое (остаточный риск #192) и утечку (всё прочее
// открытое). acceptedOpenChannels — Set каналов, за которые гейт не краснит;
// дефолт — файловые каналы secret-canary.mjs, инжектируется для теста "новый файловый
// канал вне списка = красный" (fail-closed: неизвестный канал не принимается молча).
export function evaluateGateVerdict(report, acceptedOpenChannels = RESIDUAL_RISK_CHANNELS) {
    const openChannels = report.channels.filter((c) => c.open);
    const leaked = openChannels.filter((c) => !acceptedOpenChannels.has(c.channel));
    const accepted = openChannels.filter((c) => acceptedOpenChannels.has(c.channel));
    return { ok: leaked.length === 0, leaked, accepted };
}

// Текст вердикта — значение секрета в него не попадает (detail уже редактирован
// buildReport/redact, см. secret-canary.mjs).
export function formatVerdict(verdict) {
    if (!verdict.ok) {
        const lines = verdict.leaked.map(
            (c) => `  🔓 ${c.channel}${c.label ? ` (${c.label})` : ''}: ${c.detail}`,
        );
        return [
            '⛔ канарейка секретов: НАЙДЕН СЕКРЕТ — санация env не закрыла канал(ы):',
            ...lines,
            'Это находка канарейки (утечка), а не «переменная не в allowlist» — та валит ' +
                'ДРУГОЙ чек своим сообщением инструмента, не этот. Проверь ' +
                '.claude/ralph/gate-env-allowlist.json: он не должен пропускать секреты петли.',
        ].join('\n');
    }
    const acceptedLines = verdict.accepted.map(
        (c) => `  🔓 ${c.channel}${c.label ? ` (${c.label})` : ''}: остаточный риск, см. #192`,
    );
    return [
        '✅ канарейка секретов: секретов не найдено (env-канал закрыт санацией)',
        ...(acceptedLines.length
            ? ['Остаточный риск (файловый канал, задокументирован #192):', ...acceptedLines]
            : []),
    ].join('\n');
}

function main() {
    const report = buildReport({
        env: process.env,
        readFileFn: readFileSync,
        homedir: os.homedir(),
    });
    const verdict = evaluateGateVerdict(report);
    console.log(formatReport(report));
    console.log(formatVerdict(verdict));
    if (!verdict.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
