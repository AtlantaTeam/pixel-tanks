import { describe, expect, it } from 'vitest';
import {
    checkSkip,
    expiredBaselineEntries,
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

// #230: канонический маркер собираем конкатенацией — иначе реальный `git grep` гейта нашёл
// бы skip-вызов прямо в исходнике этой фикстуры (детект .skip опирается на grep целиком, а
// после фикса pathspec `:(glob)` он видит и scripts/*.test.js). Значение маркера в рантайме
// — обычное. Паттерн вдобавок заякорен на начало строки, так что эти литералы не в начале
// строки не совпали бы и без конкатенации — это второй пояс.
const IT_SKIP = 'it' + '.skip';
const DESCRIBE_SKIP = 'describe' + '.skip';

// Детерминированное «сейчас» для проверок TTL (не завязываемся на реальную дату).
const NOW = Date.parse('2026-07-22T00:00:00Z');
const FUTURE = '2026-08-01T00:00:00Z'; // +10 дней — в пределах потолка 42
const PAST = '2026-07-01T00:00:00Z'; // просрочено
const TOO_FAR = '2027-06-01T00:00:00Z'; // дальше потолка 42 дней

const usage = (overrides = {}) => ({
    file: 'src/foo.test.ts',
    line: '4',
    snippet: `${IT_SKIP}('x', () => {`,
    ...overrides,
});

const baseline = (skips = []) => ({ skips });

// Валидная запись baseline: path/pattern/reason непустые + expiresAt в пределах потолка.
const entry = (overrides = {}) => ({
    path: 'src/**/*.test.ts',
    pattern: '.*',
    reason: 'обоснование',
    expiresAt: FUTURE,
    ...overrides,
});

describe('locateSkipUsages', () => {
    it('парсит вывод git grep в { file, line, snippet }', () => {
        const spawnFn = () => ({
            status: 0,
            stdout: `src/foo.test.ts:4:    ${IT_SKIP}('x', () => {\n`,
        });
        expect(locateSkipUsages(spawnFn)).toEqual([
            { file: 'src/foo.test.ts', line: '4', snippet: `${IT_SKIP}('x', () => {` },
        ]);
    });

    it('несколько находок — несколько записей', () => {
        const spawnFn = () => ({
            status: 0,
            stdout: `src/a.test.ts:4:${IT_SKIP}(1)\nsrc/b.test.ts:9:${DESCRIBE_SKIP}(2)\n`,
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
        const e = { path: 'src/**/*.test.ts', pattern: 'platform-specific', reason: 'r' };
        expect(
            matchesBaselineEntry(
                usage({
                    file: 'src/a.test.ts',
                    snippet: `${IT_SKIP}('platform-specific', () => {}`,
                }),
                e,
            ),
        ).toBe(true);
    });

    it('не совпадает, если путь не подходит под glob', () => {
        const e = { path: 'scripts/**/*.test.js', pattern: '.*', reason: 'r' };
        expect(matchesBaselineEntry(usage({ file: 'src/a.test.ts' }), e)).toBe(false);
    });

    it('не совпадает, если текст находки не подходит под pattern', () => {
        const e = { path: 'src/**/*.test.ts', pattern: 'windows-only', reason: 'r' };
        expect(
            matchesBaselineEntry(
                usage({ file: 'src/a.test.ts', snippet: `${IT_SKIP}('mac', () => {` }),
                e,
            ),
        ).toBe(false);
    });
});

describe('findUnexcusedSkips', () => {
    it('находка, покрытая записью baseline, исключается из результата', () => {
        const e = { path: 'src/**/*.test.ts', pattern: '.*', reason: 'r' };
        expect(findUnexcusedSkips([usage()], baseline([e]))).toEqual([]);
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
        const e = { path: 'src/**/*.test.ts', pattern: '.*', reason: 'платформенный скип' };
        const result = checkSkip([usage()], baseline([e]));
        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/skip-baseline\.json/);
    });

    it('несколько находок, одна не покрыта — красный называет только непокрытую', () => {
        const e = { path: 'src/**/*.test.ts', pattern: 'excused', reason: 'r' };
        const covered = usage({
            file: 'src/a.test.ts',
            line: '1',
            snippet: `${IT_SKIP}('excused', ...`,
        });
        const uncovered = usage({
            file: 'src/b.test.ts',
            line: '2',
            snippet: `${IT_SKIP}('new', ...`,
        });
        const result = checkSkip([covered, uncovered], baseline([e]));
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/src\/b\.test\.ts:2/);
        expect(result.message).not.toMatch(/src\/a\.test\.ts:1/);
    });
});

describe('loadBaseline — fail-closed на недоверенных данных', () => {
    it('валидный baseline с пустым skips — читается без ошибок', () => {
        const readFn = () => JSON.stringify({ skips: [] });
        expect(loadBaseline(readFn, 'x', { now: NOW }).skips).toEqual([]);
    });

    it('валидная запись (path/pattern/reason/expiresAt корректны) — читается', () => {
        const readFn = () => JSON.stringify({ skips: [entry()] });
        expect(loadBaseline(readFn, 'x', { now: NOW }).skips).toHaveLength(1);
    });

    it('skips не массив — throw', () => {
        const readFn = () => JSON.stringify({ skips: 'oops' });
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow(/массив/);
    });

    it('битый JSON — throw (JSON.parse)', () => {
        const readFn = () => '{ не json';
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow();
    });

    it('запись без path — throw', () => {
        const readFn = () => JSON.stringify({ skips: [entry({ path: undefined })] });
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow(/path/);
    });

    it('запись с неподдержанной glob-конструкцией в path ({..}) — throw', () => {
        // #230, nit: globToRegExp экранирует {,},?,[,] как литералы — исключение молча не
        // сработало бы. Отвергаем явно, а не оставляем автора гадать «почему red».
        const readFn = () => JSON.stringify({ skips: [entry({ path: 'src/**/*.test.{ts,tsx}' })] });
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow(/неподдержанную glob/);
    });

    it('запись без pattern — throw', () => {
        const readFn = () => JSON.stringify({ skips: [entry({ pattern: undefined })] });
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow(/pattern/);
    });

    it('запись с невалидным regex в pattern — throw', () => {
        const readFn = () => JSON.stringify({ skips: [entry({ pattern: '(' })] });
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow(/regex/);
    });

    it('запись без reason — throw (исключение без обоснования не принимается)', () => {
        const readFn = () => JSON.stringify({ skips: [entry({ reason: undefined })] });
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow(/reason/);
    });

    it('запись с пустой строкой reason — throw', () => {
        const readFn = () => JSON.stringify({ skips: [entry({ reason: '   ' })] });
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow(/reason/);
    });

    it('запись без expiresAt — throw (исключение обязано иметь срок пересмотра)', () => {
        const readFn = () => JSON.stringify({ skips: [entry({ expiresAt: undefined })] });
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow(/expiresAt/);
    });

    it('запись с непарсибельным expiresAt — throw', () => {
        const readFn = () => JSON.stringify({ skips: [entry({ expiresAt: 'скоро' })] });
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow(/не парсится/);
    });

    it('запись с expiresAt дальше потолка 42 дней — throw (срок «на вырост» обнуляет пересмотр)', () => {
        const readFn = () => JSON.stringify({ skips: [entry({ expiresAt: TOO_FAR })] });
        expect(() => loadBaseline(readFn, 'x', { now: NOW })).toThrow(/потолка/);
    });
});

describe('expiredBaselineEntries — TTL исключений', () => {
    it('запись с истёкшим expiresAt — просрочена', () => {
        expect(expiredBaselineEntries(baseline([entry({ expiresAt: PAST })]), NOW)).toHaveLength(1);
    });

    it('запись с будущим expiresAt — не просрочена', () => {
        expect(expiredBaselineEntries(baseline([entry({ expiresAt: FUTURE })]), NOW)).toEqual([]);
    });

    it('пустой baseline — ничего не просрочено', () => {
        expect(expiredBaselineEntries(baseline(), NOW)).toEqual([]);
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
            now: NOW,
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
            now: NOW,
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/skip-baseline/);
    });

    it('.skip не найден — зелёный', () => {
        const result = runSkipDetectCheck({
            locateSkipUsagesFn: () => [],
            loadBaselineFn: () => baseline(),
            now: NOW,
        });
        expect(result.ok).toBe(true);
    });

    it('.skip найден и не покрыт — красный', () => {
        const result = runSkipDetectCheck({
            locateSkipUsagesFn: () => [usage()],
            loadBaselineFn: () => baseline(),
            now: NOW,
        });
        expect(result.ok).toBe(false);
    });

    it('.skip найден и покрыт baseline-исключением — зелёный', () => {
        const result = runSkipDetectCheck({
            locateSkipUsagesFn: () => [usage()],
            loadBaselineFn: () => baseline([entry()]),
            now: NOW,
        });
        expect(result.ok).toBe(true);
    });

    it('просроченное исключение красит гейт, даже когда текущего .skip нет', () => {
        // TTL выносит вечное исключение на пересмотр (ревью PR #230): срок вышел — red,
        // независимо от того, есть ли сейчас скип под этой записью.
        const result = runSkipDetectCheck({
            locateSkipUsagesFn: () => [],
            loadBaselineFn: () => baseline([entry({ expiresAt: PAST })]),
            now: NOW,
        });
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/просрочен/);
    });

    it('дефолтные аргументы — используются, когда явно не переданы (не throw на вызове)', () => {
        // Реальный вызов зависит от живого состояния репозитория (настоящий git grep +
        // scripts/skip-baseline.json). Проверяем только, что дефолты подставляются и вызов
        // не бросает — утверждать .ok === true здесь значило бы завязаться на это состояние
        // и флаковать при любом легитимном изменении окружения (ревью PR #230).
        expect(() => runSkipDetectCheck()).not.toThrow();
    });

    it('ни один сбойный путь не даёт ok: true — мягкого режима нет', () => {
        const failing = [
            () =>
                runSkipDetectCheck({
                    locateSkipUsagesFn: () => {
                        throw new Error('a');
                    },
                    now: NOW,
                }),
            () =>
                runSkipDetectCheck({
                    locateSkipUsagesFn: () => [usage()],
                    loadBaselineFn: () => {
                        throw new Error('b');
                    },
                    now: NOW,
                }),
            () =>
                runSkipDetectCheck({
                    locateSkipUsagesFn: () => [usage()],
                    loadBaselineFn: () => baseline(),
                    now: NOW,
                }),
        ];
        for (const run of failing) {
            expect(run().ok).toBe(false);
        }
    });
});
