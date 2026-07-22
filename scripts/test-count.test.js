import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectTestsJson, countTests } from './test-count.mjs';

// #154: источник числа тестов — машинный отчёт vitest, не парсинг stdout. Здесь — форма
// вывода `vitest list --json`: массив записей о тест-кейсах, у каждой строковые name/file
// (снято реальным прогоном `vitest list --json=...` на этом репозитории).
const listEntry = (overrides = {}) => ({
    name: 'модуль > сценарий',
    file: '/repo/scripts/foo.test.js',
    projectName: 'ralph',
    ...overrides,
});

describe('countTests', () => {
    it('число тестов = длина массива записей списка', () => {
        expect(countTests([listEntry(), listEntry(), listEntry()])).toBe(3);
    });

    it('пустой список — ноль тестов (валидный массив, не ошибка формата)', () => {
        expect(countTests([])).toBe(0);
    });

    it('падает, когда отчёт не массив — формат неожиданный, не «посчитаем как есть»', () => {
        expect(() => countTests({ numTotalTests: 40 })).toThrow(/не массив/);
    });

    it('падает на null-отчёте — нечего читать', () => {
        expect(() => countTests(null)).toThrow(/не массив/);
    });

    it('падает, когда у записи нет строкового name — формат vitest list изменился', () => {
        expect(() => countTests([listEntry({ name: undefined })])).toThrow(/name\/file/);
    });

    it('падает, когда у записи нет строкового file — формат vitest list изменился', () => {
        expect(() => countTests([listEntry({ file: 123 })])).toThrow(/name\/file/);
    });
});

describe('collectTestsJson', () => {
    let tmpDir;

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
    });

    function tmpOutputFile() {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-count-'));
        return path.join(tmpDir, 'list.json');
    }

    it('читает список, который спавн-функция записала в outputFile', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = (cmd, args) => {
            // Реальный vitest сам пишет JSON в --json=<file> — здесь имитируем это,
            // не запуская настоящий процесс из теста.
            expect(args).toContain(`--json=${outputFile}`);
            fs.writeFileSync(outputFile, JSON.stringify([listEntry(), listEntry()]));
            return { status: 0 };
        };
        expect(collectTestsJson(spawnFn, outputFile)).toHaveLength(2);
    });

    it('собирает без прогона — команда зовётся с vitest list, не vitest run', () => {
        const outputFile = tmpOutputFile();
        let calledArgs;
        const spawnFn = (cmd, args) => {
            calledArgs = args;
            fs.writeFileSync(outputFile, JSON.stringify([listEntry()]));
            return { status: 0 };
        };
        collectTestsJson(spawnFn, outputFile);
        expect(calledArgs).toContain('list');
        expect(calledArgs).not.toContain('run');
    });

    it('секундный сбор — зовётся с --no-isolate (иначе изоляция раздувает сбор до ~20с)', () => {
        const outputFile = tmpOutputFile();
        let calledArgs;
        const spawnFn = (cmd, args) => {
            calledArgs = args;
            fs.writeFileSync(outputFile, JSON.stringify([listEntry()]));
            return { status: 0 };
        };
        collectTestsJson(spawnFn, outputFile);
        expect(calledArgs).toContain('--no-isolate');
    });

    it('не ходит в сеть — npx зовётся с --no-install', () => {
        const outputFile = tmpOutputFile();
        let calledArgs;
        const spawnFn = (cmd, args) => {
            calledArgs = args;
            fs.writeFileSync(outputFile, JSON.stringify([listEntry()]));
            return { status: 0 };
        };
        collectTestsJson(spawnFn, outputFile);
        expect(calledArgs).toContain('--no-install');
    });

    it('падает, если outputFile не появился — сбой самого запуска vitest', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => ({ status: 1, error: new Error('spawn ENOENT') });
        expect(() => collectTestsJson(spawnFn, outputFile)).toThrow(/сбой сбора/);
    });

    it('падает на нечитаемом/битом JSON в outputFile — fail-closed, не «пропустим»', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => {
            fs.writeFileSync(outputFile, '{ не json');
            return { status: 0 };
        };
        expect(() => collectTestsJson(spawnFn, outputFile)).toThrow(/не распарсился/);
    });
});
