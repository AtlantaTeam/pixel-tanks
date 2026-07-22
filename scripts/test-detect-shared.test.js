import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    TEST_FILE_GLOBS,
    collectVitestList,
    grepMarkerPattern,
    parseGrepOutput,
} from './test-detect-shared.mjs';

// #230: общая механика сбора/детекта по тест-дереву, вынесенная из трёх gate-скриптов.

describe('TEST_FILE_GLOBS', () => {
    it('каждый glob несёт magic-префикс :(glob) — иначе git fnmatch слепнет к файлам верхнего уровня каталога', () => {
        // Регрессия на 🔴 blocker ревью PR #230: без :(glob) git матчит pathspec fnmatch'ем,
        // где `**` не покрывает «ноль сегментов», и `scripts/**/*.test.js` НЕ находит
        // `scripts/x.test.js`. Для test-skip-detect (grep — единственный источник решения)
        // это дыра в самой гарантии чека. Инвариант держит префикс на месте.
        for (const glob of TEST_FILE_GLOBS) {
            expect(glob.startsWith(':(glob)')).toBe(true);
        }
    });

    it('покрывает и app (src/**), и раннер (.claude/ralph/**, scripts/**), и корневые *.config.test.ts', () => {
        const bare = TEST_FILE_GLOBS.map((g) => g.replace(':(glob)', ''));
        expect(bare).toContain('src/**/*.test.ts');
        expect(bare).toContain('.claude/ralph/**/*.test.js');
        expect(bare).toContain('scripts/**/*.test.js');
        expect(bare).toContain('*.config.test.ts');
    });
});

describe('grepMarkerPattern', () => {
    it('заякорен на начало строки после отступа — отсекает упоминания в литералах/комментариях', () => {
        expect(grepMarkerPattern('skip').startsWith('^[[:space:]]*')).toBe(true);
    });

    it('включает канонические it/test/describe и сам маркер', () => {
        const re = grepMarkerPattern('only');
        expect(re).toContain('(it|test|describe)');
        expect(re).toContain('.only');
    });

    it('only и skip отличаются только маркером', () => {
        expect(grepMarkerPattern('only').replace('.only', '.MARK')).toBe(
            grepMarkerPattern('skip').replace('.skip', '.MARK'),
        );
    });
});

describe('parseGrepOutput', () => {
    it('разбирает вывод git grep -n в { file, line, snippet }', () => {
        expect(parseGrepOutput('src/a.test.ts:4:  const x = 1;\n')).toEqual([
            { file: 'src/a.test.ts', line: '4', snippet: 'const x = 1;' },
        ]);
    });

    it('несколько строк — несколько записей', () => {
        expect(parseGrepOutput('a:1:x\nb:2:y\n')).toHaveLength(2);
    });

    it('строку без второго разделителя `:` отбрасывает, а не даёт мусорную запись', () => {
        // На выходе git grep -n такого не бывает, но молчаливый indexOf === -1 дал бы
        // { line: весь-хвост-без-последнего-символа } (ревью PR #230, nit).
        expect(parseGrepOutput('строка-без-двоеточий\n')).toEqual([]);
    });
});

describe('collectVitestList', () => {
    let tmpDir;

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
    });

    function tmpOutputFile() {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-shared-'));
        return path.join(tmpDir, 'list.json');
    }

    it('читает отчёт из outputFile и возвращает { report, status, stderr }', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => {
            fs.writeFileSync(outputFile, JSON.stringify([{ name: 'a', file: 'b' }]));
            return { status: 0, stderr: '' };
        };
        const result = collectVitestList({ spawnFn, outputFile });
        expect(result.report).toHaveLength(1);
        expect(result.status).toBe(0);
    });

    it('прокидывает extraArgs в команду (например --allowOnly=false)', () => {
        const outputFile = tmpOutputFile();
        let calledArgs;
        const spawnFn = (cmd, args) => {
            calledArgs = args;
            fs.writeFileSync(outputFile, JSON.stringify([]));
            return { status: 0 };
        };
        collectVitestList({ spawnFn, outputFile, extraArgs: ['--allowOnly=false'] });
        expect(calledArgs).toContain('--allowOnly=false');
        expect(calledArgs).toContain('list');
        expect(calledArgs).toContain('--no-isolate');
        expect(calledArgs).toContain('--no-install');
    });

    it('падает, если outputFile не появился — сбой самого сбора', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => ({ status: 1, error: new Error('spawn ENOENT') });
        expect(() => collectVitestList({ spawnFn, outputFile })).toThrow(/сбой сбора/);
    });

    it('падает на битом JSON — fail-closed, не «пропустим»', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => {
            fs.writeFileSync(outputFile, '{ не json');
            return { status: 0 };
        };
        expect(() => collectVitestList({ spawnFn, outputFile })).toThrow(/не распарсился/);
    });
});
