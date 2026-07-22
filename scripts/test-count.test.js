import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countTests, runTestsJson } from './test-count.mjs';

// #154: источник числа тестов — JSON-репортёр vitest, не парсинг stdout. Фикстура ниже —
// реальная форма отчёта (Jest-совместимый json-репортёр vitest), снятая прогоном
// `vitest run --reporter=json --outputFile=...` на этом репозитории.
const jsonReport = (overrides = {}) => ({
    numTotalTestSuites: 7,
    numPassedTestSuites: 7,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 40,
    numPassedTests: 40,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    success: true,
    testResults: [],
    ...overrides,
});

describe('countTests', () => {
    it('берёт numTotalTests из машинного отчёта', () => {
        expect(countTests(jsonReport({ numTotalTests: 123 }))).toBe(123);
    });

    it('падает на отчёте без numTotalTests — формат неожиданный, не «посчитаем как 0»', () => {
        const withoutCount = jsonReport();
        delete withoutCount.numTotalTests;
        expect(() => countTests(withoutCount)).toThrow(/numTotalTests/);
    });

    it('падает, когда numTotalTests не число — испорченный/чужой формат отчёта', () => {
        expect(() => countTests(jsonReport({ numTotalTests: '40' }))).toThrow(/numTotalTests/);
    });

    it('падает на отрицательном numTotalTests', () => {
        expect(() => countTests(jsonReport({ numTotalTests: -1 }))).toThrow(/numTotalTests/);
    });

    it('падает на null-отчёте — нечего читать', () => {
        expect(() => countTests(null)).toThrow(/numTotalTests/);
    });
});

describe('runTestsJson', () => {
    let tmpDir;

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
    });

    function tmpOutputFile() {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-count-'));
        return path.join(tmpDir, 'report.json');
    }

    it('читает отчёт, который спавн-функция записала в outputFile', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = (cmd, args) => {
            // Реальный vitest сам пишет JSON в --outputFile=... — здесь имитируем это,
            // не запуская настоящий процесс из теста.
            expect(args).toContain(`--outputFile=${outputFile}`);
            fs.writeFileSync(outputFile, JSON.stringify(jsonReport({ numTotalTests: 7 })));
            return { status: 0 };
        };
        expect(runTestsJson(spawnFn, outputFile)).toEqual(
            expect.objectContaining({ numTotalTests: 7 }),
        );
    });

    it('не парсит человекочитаемый вывод — команда зовётся с --reporter=json', () => {
        const outputFile = tmpOutputFile();
        let calledArgs;
        const spawnFn = (cmd, args) => {
            calledArgs = args;
            fs.writeFileSync(outputFile, JSON.stringify(jsonReport()));
            return { status: 0 };
        };
        runTestsJson(spawnFn, outputFile);
        expect(calledArgs).toContain('--reporter=json');
    });

    it('ненулевой код спавна (упавшие тесты) — не сбой запуска, отчёт всё равно читается', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => {
            fs.writeFileSync(
                outputFile,
                JSON.stringify(jsonReport({ numTotalTests: 5, numFailedTests: 1 })),
            );
            return { status: 1 };
        };
        expect(runTestsJson(spawnFn, outputFile).numTotalTests).toBe(5);
    });

    it('падает, если outputFile не появился — сбой самого запуска vitest', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => ({ status: 1, error: new Error('spawn ENOENT') });
        expect(() => runTestsJson(spawnFn, outputFile)).toThrow();
    });

    it('падает на нечитаемом/битом JSON в outputFile — fail-closed, не «пропустим»', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => {
            fs.writeFileSync(outputFile, '{ не json');
            return { status: 0 };
        };
        expect(() => runTestsJson(spawnFn, outputFile)).toThrow();
    });
});
