import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffSyncBlocks, extractSyncBlocks, runAgentsMdDriftCheck } from './agents-md-drift.mjs';

// #375: AGENTS.md — конвенции проекта для не-Claude кодер-рантаймов (OpenAI Codex CLI и
// т.п., не читают CLAUDE.md/.claude/rules). Копия руками дрейфует незаметно — барьер,
// не абзац в промпт (инвариант №5): маркеры `AGENTS-SYNC:START key`/`AGENTS-SYNC:END key`
// в обоих файлах, чек сверяет побайтовое совпадение содержимого одноимённых блоков.

const REPO_ROOT = resolve(import.meta.dirname, '..');

const block = (key, body) =>
    `<!-- AGENTS-SYNC:START ${key} -->${body}<!-- AGENTS-SYNC:END ${key} -->`;

describe('extractSyncBlocks', () => {
    it('находит блок по ключу и отдаёт его содержимое между маркерами', () => {
        const md = `текст до\n${block('lang', '\nтекст блока\n')}\nтекст после`;
        const blocks = extractSyncBlocks(md);
        expect(blocks.get('lang')).toBe('\nтекст блока\n');
    });

    it('находит несколько независимых блоков', () => {
        const md = `${block('a', 'A')}\n${block('b', 'B')}`;
        const blocks = extractSyncBlocks(md);
        expect(blocks.size).toBe(2);
        expect(blocks.get('a')).toBe('A');
        expect(blocks.get('b')).toBe('B');
    });

    it('без маркеров — пустая карта, не throw', () => {
        expect(extractSyncBlocks('обычный markdown без маркеров').size).toBe(0);
    });

    it('дублирующийся ключ в одном файле — throw (молчаливое перекрытие спрятало бы блок)', () => {
        const md = `${block('lang', 'первый')}\n${block('lang', 'второй')}`;
        expect(() => extractSyncBlocks(md)).toThrow(/дублирующийся ключ/);
    });

    it('маркер с разными ключами start/end не закрывается — не путает соседний блок', () => {
        // Опечатка в конце маркера (ключ end != start) — regex ищет ТОЧНО совпадающий
        // закрывающий маркер через backreference, поэтому битый блок не матчится вовсе.
        const md = '<!-- AGENTS-SYNC:START lang -->текст<!-- AGENTS-SYNC:END oops -->';
        expect(extractSyncBlocks(md).size).toBe(0);
    });
});

describe('diffSyncBlocks', () => {
    it('идентичные блоки в обоих файлах — пустой список проблем', () => {
        const source = block('lang', 'один и тот же текст');
        const target = block('lang', 'один и тот же текст');
        expect(diffSyncBlocks(source, target)).toEqual([]);
    });

    it('содержимое блока разошлось — сообщает по ключу', () => {
        const source = block('lang', 'было');
        const target = block('lang', 'стало (забыли скопировать)');
        const problems = diffSyncBlocks(source, target);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/"lang".*разош/);
    });

    it('блок есть в источнике (CLAUDE.md), но отсутствует в цели (AGENTS.md)', () => {
        const source = block('tests', 'правила тестов');
        const target = 'AGENTS.md без этого блока вовсе';
        const problems = diffSyncBlocks(source, target);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/"tests".*отсутствует в AGENTS\.md/);
    });

    it('лишний ключ в AGENTS.md, которого нет в CLAUDE.md', () => {
        const source = block('lang', 'x');
        const target = `${block('lang', 'x')}\n${block('legacy-key', 'y')}`;
        const problems = diffSyncBlocks(source, target);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/"legacy-key".*отсутствует в CLAUDE\.md/);
    });

    it('в источнике нет ни одного маркера — fail-closed, а не "сверять нечего"', () => {
        const problems = diffSyncBlocks('CLAUDE.md без маркеров вовсе', block('lang', 'x'));
        expect(problems.some((p) => /не найдено ни одного блока/.test(p))).toBe(true);
    });

    it('несколько блоков разошлись сразу — ВСЕ проблемы в списке (накопление, не первая ошибка)', () => {
        const source = `${block('a', '1')}\n${block('b', '2')}`;
        const target = `${block('a', 'ИНОЕ')}\n${block('b', 'ДРУГОЕ')}`;
        const problems = diffSyncBlocks(source, target);
        expect(problems).toHaveLength(2);
        expect(problems.some((p) => /"a"/.test(p))).toBe(true);
        expect(problems.some((p) => /"b"/.test(p))).toBe(true);
    });
});

describe('runAgentsMdDriftCheck', () => {
    it('зелёный, когда все синк-блоки совпадают', () => {
        const files = {
            '/repo/CLAUDE.md': block('lang', 'русский'),
            '/repo/AGENTS.md': block('lang', 'русский'),
        };
        const result = runAgentsMdDriftCheck({
            readFileFn: (p) => files[p],
            claudePath: '/repo/CLAUDE.md',
            agentsPath: '/repo/AGENTS.md',
        });
        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/синхронизирован/);
    });

    it('красный с перечислением расхождений, когда блок разошёлся', () => {
        const files = {
            '/repo/CLAUDE.md': block('lang', 'было'),
            '/repo/AGENTS.md': block('lang', 'стало'),
        };
        const result = runAgentsMdDriftCheck({
            readFileFn: (p) => files[p],
            claudePath: '/repo/CLAUDE.md',
            agentsPath: '/repo/AGENTS.md',
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/"lang"/);
    });

    it('CLAUDE.md не читается — красный с честной причиной, не throw наружу', () => {
        const result = runAgentsMdDriftCheck({
            readFileFn: () => {
                throw new Error('ENOENT');
            },
            claudePath: '/repo/CLAUDE.md',
            agentsPath: '/repo/AGENTS.md',
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/CLAUDE\.md/);
    });

    it('AGENTS.md не читается — красный с честной причиной', () => {
        const files = { '/repo/CLAUDE.md': block('lang', 'x') };
        const result = runAgentsMdDriftCheck({
            readFileFn: (p) => {
                if (!(p in files)) throw new Error('ENOENT');
                return files[p];
            },
            claudePath: '/repo/CLAUDE.md',
            agentsPath: '/repo/AGENTS.md',
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/AGENTS\.md/);
    });

    it('дубль ключа — красный, а не throw наружу', () => {
        const dup = `${block('lang', 'a')}\n${block('lang', 'b')}`;
        const files = { '/repo/CLAUDE.md': dup, '/repo/AGENTS.md': dup };
        const result = runAgentsMdDriftCheck({
            readFileFn: (p) => files[p],
            claudePath: '/repo/CLAUDE.md',
            agentsPath: '/repo/AGENTS.md',
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/дублирующийся ключ/);
    });

    // Регрессионная проверка настоящих файлов репозитория: реальный CLAUDE.md и AGENTS.md
    // обязаны быть синхронизированы прямо сейчас — этот тест и есть unit-эквивалент того,
    // что гоняет гейт (`npm run docs:agents-drift`) на живом дереве.
    it('реальные CLAUDE.md и AGENTS.md репозитория синхронизированы', () => {
        const claudeSrc = readFileSync(resolve(REPO_ROOT, 'CLAUDE.md'), 'utf-8');
        const agentsSrc = readFileSync(resolve(REPO_ROOT, 'AGENTS.md'), 'utf-8');
        expect(diffSyncBlocks(claudeSrc, agentsSrc)).toEqual([]);
        expect(extractSyncBlocks(claudeSrc).size).toBeGreaterThan(0);
    });
});
