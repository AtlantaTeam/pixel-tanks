import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    checkOnly,
    collectOnlyReport,
    locateOnlyUsages,
    runOnlyDetectCheck,
} from './test-only-detect.mjs';

// #160: детект it.only/describe.only в unit-гейте. Vitest умеет это нативно —
// `--allowOnly=false` (тот же механизм, что forbidOnly у Playwright под CI=1; PRD
// ошибочно решил, что аналога нет, проверено реальным прогоном). Решение red/green —
// код выхода `vitest list --allowOnly=false` (авторитетно, парсит реальное тест-дерево).
// На прогоне ВСЕГО дерева .only не сужает список глобально (проверено запуском) —
// report для «места находки» бесполезен, поэтому локация — отдельный best-effort шаг
// (`git grep` по каноничной форме it.only(/describe.only(), не влияющий на red/green.

// #230: маркер собираем конкатенацией — иначе после фикса pathspec `:(glob)` реальный
// `git grep` локатора нашёл бы `it.only(` в исходнике этой фикстуры и указал бы на неё как
// на «место находки» (для .only grep — лишь подсказка, red/green решает vitest, но
// сообщение врало бы). Значение в рантайме — обычные "it.only("/"describe.only(".
const IT_ONLY = 'it' + '.only';
const DESCRIBE_ONLY = 'describe' + '.only';

const listEntry = (overrides = {}) => ({
    name: 'модуль > сценарий',
    file: '/repo/src/foo.test.ts',
    projectName: 'app',
    ...overrides,
});

describe('checkOnly', () => {
    it('код выхода 0 — зелёный, .only нет', () => {
        const result = checkOnly({ status: 0, report: [listEntry(), listEntry()] });
        expect(result.ok).toBe(true);
    });

    it('ненулевой код + непустой отчёт — красный, называет место из локатора', () => {
        const result = checkOnly({ status: 1, report: [listEntry()] }, () => [
            { file: 'src/foo.test.ts', line: '4', snippet: `${IT_ONLY}('x', ...)` },
        ]);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/src\/foo\.test\.ts:4/);
    });

    it('красный называет все найденные локатором места', () => {
        const result = checkOnly({ status: 1, report: [listEntry()] }, () => [
            { file: 'src/a.test.ts', line: '4', snippet: '' },
            { file: 'src/b.test.ts', line: '9', snippet: '' },
        ]);
        expect(result.message).toMatch(/src\/a\.test\.ts:4/);
        expect(result.message).toMatch(/src\/b\.test\.ts:9/);
    });

    it('локатор ничего не нашёл — всё равно красный, сообщение честно об этом говорит', () => {
        const result = checkOnly({ status: 1, report: [listEntry()] }, () => []);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/не наш/);
    });

    it('локатор пуст, но есть stderr сбора — его хвост попадает в сообщение (причина ненулевого кода)', () => {
        // #230, minor: ненулевой код бывает и не из-за .only (сбой projects, teardown).
        // Тогда «ищи .only вручную» отправляет чинить то, чего нет — поэтому прокидываем
        // хвост stderr, чтобы истинная причина была видна сразу.
        const result = checkOnly(
            { status: 1, report: [listEntry()], stderr: 'boom teardown fail' },
            () => [],
        );
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/boom teardown fail/);
    });

    it('дефолтный локатор — используется, когда явно не передан (не throw на вызове)', () => {
        // locateOnlyUsages зовёт реальный git grep — здесь проверяем только, что дефолт
        // подставляется и вызов не бросает (для .only grep — best-effort подсказка, red/green
        // на нём не завязан, так что живое состояние репозитория на исход не влияет).
        expect(() => checkOnly({ status: 1, report: [listEntry()] })).not.toThrow();
    });

    it('ненулевой код, но отчёт пуст — fail-closed throw (формат неожиданный, не «зелёный»)', () => {
        expect(() => checkOnly({ status: 1, report: [] })).toThrow(/неожидан/);
    });

    it('ненулевой код, отчёт не массив — fail-closed throw', () => {
        expect(() => checkOnly({ status: 1, report: null })).toThrow(/неожидан/);
    });
});

describe('locateOnlyUsages', () => {
    it('парсит вывод git grep в { file, line, snippet }', () => {
        const spawnFn = () => ({
            status: 0,
            stdout: `src/foo.test.ts:4:    ${IT_ONLY}('x', () => {\n`,
        });
        expect(locateOnlyUsages(spawnFn)).toEqual([
            { file: 'src/foo.test.ts', line: '4', snippet: `${IT_ONLY}('x', () => {` },
        ]);
    });

    it('несколько находок — несколько записей', () => {
        const spawnFn = () => ({
            status: 0,
            stdout: `src/a.test.ts:4:${IT_ONLY}(1)\nsrc/b.test.ts:9:${DESCRIBE_ONLY}(2)\n`,
        });
        expect(locateOnlyUsages(spawnFn)).toHaveLength(2);
    });

    it('git grep не нашёл совпадений (код 1) — пустой массив, не throw', () => {
        const spawnFn = () => ({ status: 1, stdout: '' });
        expect(locateOnlyUsages(spawnFn)).toEqual([]);
    });

    it('git grep упал (не git-репозиторий и т.п.) — пустой массив, не throw (best-effort)', () => {
        const spawnFn = () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' });
        expect(locateOnlyUsages(spawnFn)).toEqual([]);
    });

    it('зовёт git grep с --untracked (новый .only-файл может быть ещё не staged)', () => {
        let calledArgs;
        const spawnFn = (cmd, args) => {
            calledArgs = args;
            return { status: 1, stdout: '' };
        };
        locateOnlyUsages(spawnFn);
        expect(calledArgs).toContain('--untracked');
    });
});

describe('collectOnlyReport', () => {
    let tmpDir;

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
    });

    function tmpOutputFile() {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-only-detect-'));
        return path.join(tmpDir, 'list.json');
    }

    it('код выхода 0 (нет .only) — отчёт распарсен, status прокинут как есть', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => {
            fs.writeFileSync(outputFile, JSON.stringify([listEntry(), listEntry()]));
            return { status: 0 };
        };
        const result = collectOnlyReport(spawnFn, outputFile);
        expect(result.status).toBe(0);
        expect(result.report).toHaveLength(2);
    });

    it('ненулевой код с валидным JSON — НЕ throw, report/status прокинуты (allowOnly-находка)', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => {
            fs.writeFileSync(outputFile, JSON.stringify([listEntry({ name: 'a > only' })]));
            return { status: 1 };
        };
        const result = collectOnlyReport(spawnFn, outputFile);
        expect(result.status).toBe(1);
        expect(result.report).toEqual([listEntry({ name: 'a > only' })]);
    });

    it('зовётся с vitest list (не run) и --allowOnly=false', () => {
        const outputFile = tmpOutputFile();
        let calledArgs;
        const spawnFn = (cmd, args) => {
            calledArgs = args;
            fs.writeFileSync(outputFile, JSON.stringify([listEntry()]));
            return { status: 0 };
        };
        collectOnlyReport(spawnFn, outputFile);
        expect(calledArgs).toContain('list');
        expect(calledArgs).not.toContain('run');
        expect(calledArgs).toContain('--allowOnly=false');
    });

    it('секундный сбор — --no-isolate, не ходит в сеть — --no-install', () => {
        const outputFile = tmpOutputFile();
        let calledArgs;
        const spawnFn = (cmd, args) => {
            calledArgs = args;
            fs.writeFileSync(outputFile, JSON.stringify([listEntry()]));
            return { status: 0 };
        };
        collectOnlyReport(spawnFn, outputFile);
        expect(calledArgs).toContain('--no-isolate');
        expect(calledArgs).toContain('--no-install');
    });

    it('падает, если outputFile не появился — сбой самого сбора (например, синтаксис)', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => ({ status: 1, error: new Error('spawn ENOENT') });
        expect(() => collectOnlyReport(spawnFn, outputFile)).toThrow(/сбой сбора/);
    });

    it('падает на нечитаемом/битом JSON в outputFile — fail-closed, не «пропустим»', () => {
        const outputFile = tmpOutputFile();
        const spawnFn = () => {
            fs.writeFileSync(outputFile, '{ не json');
            return { status: 1 };
        };
        expect(() => collectOnlyReport(spawnFn, outputFile)).toThrow(/не распарсился/);
    });
});

// Склейка целиком (аналог runRatchetCheck #157): недоверенные данные не проходят зелёным
// ни на одном шаге.
describe('runOnlyDetectCheck — fail-closed на недоверенных данных', () => {
    it('сбой сбора — красный, исключение не улетает наружу необработанным', () => {
        const result = runOnlyDetectCheck({
            collectOnlyReportFn: () => {
                throw new Error('vitest не записал список тестов — сбой сбора');
            },
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/сбой сбора/);
    });

    it('.only найден — красный с указанием места из локатора', () => {
        const result = runOnlyDetectCheck({
            collectOnlyReportFn: () => ({ status: 1, report: [listEntry()] }),
            locateOnlyUsagesFn: () => [{ file: '/x/foo.test.ts', line: '3', snippet: '' }],
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/foo\.test\.ts:3/);
    });

    it('.only нет — зелёный', () => {
        const result = runOnlyDetectCheck({
            collectOnlyReportFn: () => ({ status: 0, report: [listEntry()] }),
        });
        expect(result.ok).toBe(true);
    });

    it('ни один сбойный путь не даёт ok: true — мягкого режима нет', () => {
        const failing = [
            () => {
                throw new Error('a');
            },
            () => ({ status: 1, report: [] }),
            () => ({ status: 1, report: null }),
        ];
        for (const collectOnlyReportFn of failing) {
            expect(runOnlyDetectCheck({ collectOnlyReportFn }).ok).toBe(false);
        }
    });
});
