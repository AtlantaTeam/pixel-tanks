import { describe, expect, it } from 'vitest';
import {
    checkSkip,
    findUnexcusedSkips,
    globToRegExp,
    loadBaseline,
    locateSkipUsages,
    matchesBaselineEntry,
    runSkipDetectCheck,
} from './test-skip-detect.mjs';

// #161: осознанные исключения по .skip через baseline-механизм — вариант (а)
// (docs/ralph-reliability/phase4-only-skip-detect/research.md, #159). В отличие от .only
// (#160), у vitest нет флага «запретить .skip» — детект целиком на `git grep`, поэтому
// код выхода, отличный от 0 (совпадения) и 1 (нет совпадений), обязан красить гейт, а не
// молча трактоваться как «skip не найден».

const usage = (overrides = {}) => ({
    file: 'src/foo.test.ts',
    line: '4',
    snippet: "it.skip('x', () => {",
    ...overrides,
});

const baseline = (skips = []) => ({ skips });

describe('locateSkipUsages', () => {
    it('парсит вывод git grep в { file, line, snippet }', () => {
        const spawnFn = () => ({
            status: 0,
            stdout: "src/foo.test.ts:4:    it.skip('x', () => {\n",
        });
        expect(locateSkipUsages(spawnFn)).toEqual([
            { file: 'src/foo.test.ts', line: '4', snippet: "it.skip('x', () => {" },
        ]);
    });

    it('несколько находок — несколько записей', () => {
        const spawnFn = () => ({
            status: 0,
            stdout: 'src/a.test.ts:4:it.skip(1)\nsrc/b.test.ts:9:describe.skip(2)\n',
        });
        expect(locateSkipUsages(spawnFn)).toHaveLength(2);
    });

    it('git grep не нашёл совпадений (код 1) — пустой массив, не throw', () => {
        const spawnFn = () => ({ status: 1, stdout: '' });
        expect(locateSkipUsages(spawnFn)).toEqual([]);
    });

    it('git grep упал (не git-репозиторий, битый regex и т.п.) — fail-closed throw, НЕ пустой массив', () => {
        // Отличие от test-only-detect.mjs: там git grep — только подсказка к сообщению,
        // здесь — единственный источник решения red/green. Молчаливое «не нашли» на сбое
        // сделало бы гейт слепым, а не зелёным по праву.
        const spawnFn = () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' });
        expect(() => locateSkipUsages(spawnFn)).toThrow(/неожиданно/);
    });

    it('зовёт git grep с --untracked (новый .skip-файл может быть ещё не staged)', () => {
        let calledArgs;
        const spawnFn = (cmd, args) => {
            calledArgs = args;
            return { status: 1, stdout: '' };
        };
        locateSkipUsages(spawnFn);
        expect(calledArgs).toContain('--untracked');
    });
});

describe('globToRegExp', () => {
    it('** соответствует нулю или более сегментам пути', () => {
        const re = globToRegExp('src/**/*.test.ts');
        expect(re.test('src/foo.test.ts')).toBe(true);
        expect(re.test('src/features/game-engine/foo.test.ts')).toBe(true);
    });

    it('* не пересекает границу сегмента пути', () => {
        const re = globToRegExp('scripts/*.test.js');
        expect(re.test('scripts/foo.test.js')).toBe(true);
        expect(re.test('scripts/nested/foo.test.js')).toBe(false);
    });

    it('точка в паттерне — буквальная, не «любой символ»', () => {
        const re = globToRegExp('*.test.ts');
        expect(re.test('fooXtestYts')).toBe(false);
    });
});

describe('matchesBaselineEntry', () => {
    it('совпадает, когда путь по glob и текст находки по pattern оба подходят', () => {
        const entry = {
            path: 'src/**/*.test.ts',
            pattern: 'platform-specific',
            reason: 'r',
        };
        expect(
            matchesBaselineEntry(
                usage({ file: 'src/a.test.ts', snippet: "it.skip('platform-specific', () => {}" }),
                entry,
            ),
        ).toBe(true);
    });

    it('не совпадает, если путь не подходит под glob', () => {
        const entry = { path: 'scripts/**/*.test.js', pattern: '.*', reason: 'r' };
        expect(matchesBaselineEntry(usage({ file: 'src/a.test.ts' }), entry)).toBe(false);
    });

    it('не совпадает, если текст находки не подходит под pattern', () => {
        const entry = { path: 'src/**/*.test.ts', pattern: 'windows-only', reason: 'r' };
        expect(
            matchesBaselineEntry(
                usage({ file: 'src/a.test.ts', snippet: "it.skip('mac', () => {" }),
                entry,
            ),
        ).toBe(false);
    });
});

describe('findUnexcusedSkips', () => {
    it('находка, покрытая записью baseline, исключается из результата', () => {
        const entry = { path: 'src/**/*.test.ts', pattern: '.*', reason: 'r' };
        expect(findUnexcusedSkips([usage()], baseline([entry]))).toEqual([]);
    });

    it('находка без покрывающей записи остаётся в результате', () => {
        const u = usage();
        expect(findUnexcusedSkips([u], baseline([]))).toEqual([u]);
    });

    it('пустой baseline (skips: []) — ничего не исключает', () => {
        const u = usage();
        expect(findUnexcusedSkips([u], baseline())).toEqual([u]);
    });
});

describe('checkSkip', () => {
    it('.skip не найден — зелёный', () => {
        const result = checkSkip([], baseline());
        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/не найден/);
    });

    it('.skip найден и не покрыт baseline — красный, называет место', () => {
        const result = checkSkip([usage({ file: 'src/a.test.ts', line: '7' })], baseline());
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/src\/a\.test\.ts:7/);
    });

    it('.skip найден, но полностью покрыт baseline-исключением — зелёный', () => {
        const entry = { path: 'src/**/*.test.ts', pattern: '.*', reason: 'платформенный скип' };
        const result = checkSkip([usage()], baseline([entry]));
        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/skip-baseline\.json/);
    });

    it('несколько находок, одна не покрыта — красный называет только непокрытую', () => {
        const entry = { path: 'src/**/*.test.ts', pattern: 'excused', reason: 'r' };
        const covered = usage({
            file: 'src/a.test.ts',
            line: '1',
            snippet: "it.skip('excused', ...",
        });
        const uncovered = usage({
            file: 'src/b.test.ts',
            line: '2',
            snippet: "it.skip('new', ...",
        });
        const result = checkSkip([covered, uncovered], baseline([entry]));
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/src\/b\.test\.ts:2/);
        expect(result.message).not.toMatch(/src\/a\.test\.ts:1/);
    });
});

describe('loadBaseline — fail-closed на недоверенных данных', () => {
    it('валидный baseline с пустым skips — читается без ошибок', () => {
        const readFn = () => JSON.stringify({ skips: [] });
        expect(loadBaseline(readFn, 'x').skips).toEqual([]);
    });

    it('валидная запись (path/pattern/reason непустые, pattern компилируется) — читается', () => {
        const readFn = () =>
            JSON.stringify({
                skips: [{ path: 'src/**/*.test.ts', pattern: '.*', reason: 'обоснование' }],
            });
        expect(loadBaseline(readFn, 'x').skips).toHaveLength(1);
    });

    it('skips не массив — throw', () => {
        const readFn = () => JSON.stringify({ skips: 'oops' });
        expect(() => loadBaseline(readFn, 'x')).toThrow(/массив/);
    });

    it('битый JSON — throw (JSON.parse)', () => {
        const readFn = () => '{ не json';
        expect(() => loadBaseline(readFn, 'x')).toThrow();
    });

    it('запись без path — throw', () => {
        const readFn = () => JSON.stringify({ skips: [{ pattern: '.*', reason: 'r' }] });
        expect(() => loadBaseline(readFn, 'x')).toThrow(/path/);
    });

    it('запись без pattern — throw', () => {
        const readFn = () => JSON.stringify({ skips: [{ path: 'a', reason: 'r' }] });
        expect(() => loadBaseline(readFn, 'x')).toThrow(/pattern/);
    });

    it('запись с невалидным regex в pattern — throw', () => {
        const readFn = () => JSON.stringify({ skips: [{ path: 'a', pattern: '(', reason: 'r' }] });
        expect(() => loadBaseline(readFn, 'x')).toThrow(/regex/);
    });

    it('запись без reason — throw (исключение без обоснования не принимается)', () => {
        const readFn = () => JSON.stringify({ skips: [{ path: 'a', pattern: '.*' }] });
        expect(() => loadBaseline(readFn, 'x')).toThrow(/reason/);
    });

    it('запись с пустой строкой reason — throw', () => {
        const readFn = () =>
            JSON.stringify({ skips: [{ path: 'a', pattern: '.*', reason: '   ' }] });
        expect(() => loadBaseline(readFn, 'x')).toThrow(/reason/);
    });
});

// Склейка целиком (аналог runOnlyDetectCheck/runRatchetCheck): недоверенные данные не
// проходят зелёным ни на одном шаге.
describe('runSkipDetectCheck — fail-closed на недоверенных данных', () => {
    it('сбой git grep — красный, исключение не улетает наружу необработанным', () => {
        const result = runSkipDetectCheck({
            locateSkipUsagesFn: () => {
                throw new Error('git grep для детекта .skip завершился неожиданно');
            },
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/неожиданно/);
    });

    it('сбой чтения baseline — красный', () => {
        const result = runSkipDetectCheck({
            locateSkipUsagesFn: () => [],
            loadBaselineFn: () => {
                throw new Error('skip-baseline.json без корректного массива skips');
            },
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/skip-baseline/);
    });

    it('.skip не найден — зелёный', () => {
        const result = runSkipDetectCheck({
            locateSkipUsagesFn: () => [],
            loadBaselineFn: () => baseline(),
        });
        expect(result.ok).toBe(true);
    });

    it('.skip найден и не покрыт — красный', () => {
        const result = runSkipDetectCheck({
            locateSkipUsagesFn: () => [usage()],
            loadBaselineFn: () => baseline(),
        });
        expect(result.ok).toBe(false);
    });

    it('.skip найден и покрыт baseline-исключением — зелёный', () => {
        const entry = { path: 'src/**/*.test.ts', pattern: '.*', reason: 'r' };
        const result = runSkipDetectCheck({
            locateSkipUsagesFn: () => [usage()],
            loadBaselineFn: () => baseline([entry]),
        });
        expect(result.ok).toBe(true);
    });

    it('дефолтные аргументы — используются, когда явно не переданы (не throw на вызове)', () => {
        // В этом репозитории на момент теста .skip нет нигде, а scripts/skip-baseline.json
        // — валидный пустой baseline, поэтому реальный вызов безопасен.
        expect(() => runSkipDetectCheck()).not.toThrow();
        expect(runSkipDetectCheck().ok).toBe(true);
    });

    it('ни один сбойный путь не даёт ok: true — мягкого режима нет', () => {
        const failing = [
            () =>
                runSkipDetectCheck({
                    locateSkipUsagesFn: () => {
                        throw new Error('a');
                    },
                }),
            () =>
                runSkipDetectCheck({
                    locateSkipUsagesFn: () => [usage()],
                    loadBaselineFn: () => {
                        throw new Error('b');
                    },
                }),
            () =>
                runSkipDetectCheck({
                    locateSkipUsagesFn: () => [usage()],
                    loadBaselineFn: () => baseline(),
                }),
        ];
        for (const run of failing) {
            expect(run().ok).toBe(false);
        }
    });
});
