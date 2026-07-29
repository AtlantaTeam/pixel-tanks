#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// #375: не-Claude кодер-рантаймы (OpenAI Codex CLI) не читают CLAUDE.md/.claude/rules —
// им нужен AGENTS.md с теми же проектными конвенциями. Копия руками дрейфует незаметно
// (правка CLAUDE.md, забытая в AGENTS.md) — барьер вместо промпта (инвариант №5 в
// .claude/ralph/CLAUDE.md): CLAUDE.md и AGENTS.md несут одноимённые блоки, обрамлённые
// маркерами `<!-- AGENTS-SYNC:START <key> -->` / `<!-- AGENTS-SYNC:END <key> -->`; этот
// чек сверяет, что содержимое блока с одним и тем же ключом побайтово совпадает в обоих
// файлах — набор ключей и текст внутри.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SYNC_BLOCK_RE =
    /<!--\s*AGENTS-SYNC:START\s+(\S+)\s*-->([\s\S]*?)<!--\s*AGENTS-SYNC:END\s+\1\s*-->/g;

// Чистая функция: ключ синк-блока → его содержимое (между маркерами, маркеры не входят).
// Дубль ключа в одном файле — throw, не «последний победил»: молчаливое перекрытие
// спрятало бы блок от сверки (тот же класс, что looksBlind в security-audit.mjs).
export function extractSyncBlocks(markdown) {
    const blocks = new Map();
    for (const match of markdown.matchAll(SYNC_BLOCK_RE)) {
        const [, key, body] = match;
        if (blocks.has(key)) {
            throw new Error(
                `дублирующийся ключ синк-блока "${key}" — маркеры обязаны быть уникальны`,
            );
        }
        blocks.set(key, body);
    }
    return blocks;
}

// Сверка УЖЕ РАЗОБРАННЫХ блоков source (CLAUDE.md) → target (AGENTS.md). Вынесена из
// diffSyncBlocks, чтобы вызывающий (runAgentsMdDriftCheck), которому нужен ещё и счётчик
// блоков, парсил каждый файл РОВНО ОДИН раз, а не гонял regex повторно ради размера.
function diffParsedBlocks(
    source,
    target,
    { sourceName = 'CLAUDE.md', targetName = 'AGENTS.md' } = {},
) {
    const problems = [];

    if (source.size === 0) {
        problems.push(
            `в ${sourceName} не найдено ни одного блока AGENTS-SYNC — проверка не сверила бы ничего`,
        );
    }

    for (const [key, body] of source) {
        if (!target.has(key)) {
            problems.push(`блок "${key}" есть в ${sourceName}, но отсутствует в ${targetName}`);
            continue;
        }
        if (target.get(key) !== body) {
            problems.push(
                `блок "${key}" разошёлся между ${sourceName} и ${targetName} — скопируй актуальный текст`,
            );
        }
    }
    for (const key of target.keys()) {
        if (!source.has(key)) {
            problems.push(
                `блок "${key}" есть в ${targetName}, но отсутствует в ${sourceName} — лишний или переименованный ключ`,
            );
        }
    }
    return problems;
}

// Публичная обёртка: парсит оба markdown и сверяет. Fail-closed на пустом source и на
// дубле ключа (throw из extractSyncBlocks) — контракт как раньше; тонкая проводка над
// diffParsedBlocks.
export function diffSyncBlocks(sourceMarkdown, targetMarkdown, opts = {}) {
    return diffParsedBlocks(
        extractSyncBlocks(sourceMarkdown),
        extractSyncBlocks(targetMarkdown),
        opts,
    );
}

// Сборка чека в одну тестируемую функцию (аналог runOnlyDetectCheck): любая ошибка
// (нечитаемый файл, дубль ключа) превращается в { ok: false }, а не падает наружу.
export function runAgentsMdDriftCheck({
    readFileFn = (path) => readFileSync(path, 'utf-8'),
    claudePath = join(REPO_ROOT, 'CLAUDE.md'),
    agentsPath = join(REPO_ROOT, 'AGENTS.md'),
} = {}) {
    let claudeSrc;
    let agentsSrc;
    try {
        claudeSrc = readFileFn(claudePath);
    } catch (e) {
        return { ok: false, message: `не смог прочитать ${claudePath}: ${e.message}` };
    }
    try {
        agentsSrc = readFileFn(agentsPath);
    } catch (e) {
        return { ok: false, message: `не смог прочитать ${agentsPath}: ${e.message}` };
    }

    // Парсим КАЖДЫЙ файл ровно один раз: карты нужны и для сверки, и для счётчика блоков
    // в сообщении об успехе (раньше extractSyncBlocks(claudeSrc) гонялся повторно ради size).
    let claudeBlocks;
    let agentsBlocks;
    try {
        claudeBlocks = extractSyncBlocks(claudeSrc);
        agentsBlocks = extractSyncBlocks(agentsSrc);
    } catch (e) {
        return { ok: false, message: e.message };
    }
    const problems = diffParsedBlocks(claudeBlocks, agentsBlocks);
    if (problems.length > 0) {
        return { ok: false, message: problems.join('; ') };
    }
    return {
        ok: true,
        message: `AGENTS.md синхронизирован с CLAUDE.md (${claudeBlocks.size} блоков)`,
    };
}

function main() {
    const { ok, message } = runAgentsMdDriftCheck();
    if (!ok) {
        console.error(`⛔ agents-md-drift: ${message}`);
        process.exit(1);
    }
    console.log(`✅ agents-md-drift: ${message}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
