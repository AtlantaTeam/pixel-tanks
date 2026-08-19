import { describe, expect, it } from 'vitest';
import {
    appendJournalEntry,
    JOURNAL_PATH,
    JOURNAL_SOURCES,
    recordFixReviewFindings,
    recordReviewLoopFindings,
} from './review-findings-journal.mjs';

// #169: журнал находок по фазам с разметкой источника. writeFn/appendFn инжектируются
// целиком — реальная запись на диск (в т.ч. боевой JOURNAL_PATH) в тестах запрещена, как
// и реальный gh в review-findings.test.js.

const VALID_COUNTS = { blocker: 1, major: 2, minor: 0, nit: 3, unmarked: 1, total: 7 };

describe('JOURNAL_SOURCES', () => {
    it('три размеченных категории источника: обе половины метрики и проход ревью правок', () => {
        expect(JOURNAL_SOURCES).toEqual(['review-loop', 'found-after', 'review-of-fixes']);
    });
});

describe('appendJournalEntry', () => {
    it('пишет одну JSON-строку с переводом строки в конце', () => {
        const calls = [];
        const entry = appendJournalEntry(
            { milestone: 'Фаза 6', source: 'review-loop', pr: 235, counts: VALID_COUNTS },
            {
                writeFn: (path, data) => calls.push({ path, data }),
                nowFn: () => '2026-07-23T10:00:00.000Z',
            },
        );
        expect(calls).toHaveLength(1);
        expect(calls[0].path).toBe(JOURNAL_PATH);
        expect(calls[0].data.endsWith('\n')).toBe(true);
        expect(JSON.parse(calls[0].data)).toEqual({
            ts: '2026-07-23T10:00:00.000Z',
            milestone: 'Фаза 6',
            source: 'review-loop',
            pr: 235,
            // #625: поле есть у КАЖДОЙ записи (null там, где запись не про отдельный
            // проход) — иначе читателю журнала пришлось бы различать две формы строки.
            pass: null,
            counts: VALID_COUNTS,
        });
        expect(entry.pr).toBe(235);
    });

    it('уважает journalPath из опций', () => {
        const calls = [];
        appendJournalEntry(
            { milestone: 'Фаза 6', source: 'found-after', counts: VALID_COUNTS },
            {
                journalPath: 'docs/custom.jsonl',
                writeFn: (path, data) => calls.push({ path, data }),
            },
        );
        expect(calls[0].path).toBe('docs/custom.jsonl');
    });

    it('pr необязателен (found-after без привязки к конкретному PR) — пишется null', () => {
        const calls = [];
        appendJournalEntry(
            { milestone: 'Фаза 6', source: 'found-after', counts: VALID_COUNTS },
            { writeFn: (path, data) => calls.push(data) },
        );
        expect(JSON.parse(calls[0]).pr).toBeNull();
    });

    it('пустой набор находок (все счётчики ноль) — легитимная запись, не ошибка', () => {
        const calls = [];
        const zero = { blocker: 0, major: 0, minor: 0, nit: 0, unmarked: 0, total: 0 };
        appendJournalEntry(
            { milestone: 'Фаза 6', source: 'review-loop', pr: 1, counts: zero },
            { writeFn: (path, data) => calls.push(data) },
        );
        expect(JSON.parse(calls[0]).counts).toEqual(zero);
    });

    it('пустой milestone — throw, запись не пишется', () => {
        const calls = [];
        expect(() =>
            appendJournalEntry(
                { milestone: '', source: 'review-loop', pr: 1, counts: VALID_COUNTS },
                { writeFn: (p, d) => calls.push(d) },
            ),
        ).toThrow(/milestone/);
        expect(calls).toHaveLength(0);
    });

    it('source вне JOURNAL_SOURCES — throw, запись не пишется', () => {
        const calls = [];
        expect(() =>
            appendJournalEntry(
                { milestone: 'Фаза 6', source: 'ghost', pr: 1, counts: VALID_COUNTS },
                { writeFn: (p, d) => calls.push(d) },
            ),
        ).toThrow(/source/);
        expect(calls).toHaveLength(0);
    });

    it('pr не положительное целое — throw', () => {
        expect(() =>
            appendJournalEntry(
                { milestone: 'Фаза 6', source: 'review-loop', pr: 0, counts: VALID_COUNTS },
                { writeFn: () => {} },
            ),
        ).toThrow(/pr/);
        expect(() =>
            appendJournalEntry(
                { milestone: 'Фаза 6', source: 'review-loop', pr: -3, counts: VALID_COUNTS },
                { writeFn: () => {} },
            ),
        ).toThrow(/pr/);
        expect(() =>
            appendJournalEntry(
                { milestone: 'Фаза 6', source: 'review-loop', pr: '235', counts: VALID_COUNTS },
                { writeFn: () => {} },
            ),
        ).toThrow(/pr/);
    });

    it('counts не объект — throw, запись не пишется', () => {
        const calls = [];
        expect(() =>
            appendJournalEntry(
                { milestone: 'Фаза 6', source: 'review-loop', pr: 1, counts: null },
                { writeFn: (p, d) => calls.push(d) },
            ),
        ).toThrow(/counts/);
        expect(calls).toHaveLength(0);
    });

    it('в counts не хватает ключа severity — throw (не тихо пишет частичный счёт)', () => {
        const incomplete = { ...VALID_COUNTS };
        delete incomplete.total;
        expect(() =>
            appendJournalEntry(
                { milestone: 'Фаза 6', source: 'review-loop', pr: 1, counts: incomplete },
                { writeFn: () => {} },
            ),
        ).toThrow(/counts\.total/);
    });

    it('отрицательное значение в counts — throw', () => {
        expect(() =>
            appendJournalEntry(
                {
                    milestone: 'Фаза 6',
                    source: 'review-loop',
                    pr: 1,
                    counts: { ...VALID_COUNTS, blocker: -1 },
                },
                { writeFn: () => {} },
            ),
        ).toThrow(/counts\.blocker/);
    });

    it('#237 total не равен сумме частей — throw, запись не пишется', () => {
        const calls = [];
        expect(() =>
            appendJournalEntry(
                {
                    milestone: 'Фаза 6',
                    source: 'review-loop',
                    pr: 1,
                    // 1+2+0+3+1 = 7, но total выставлен в 40 — рассинхрон, метрика соврала бы.
                    counts: { ...VALID_COUNTS, total: 40 },
                },
                { writeFn: (p, d) => calls.push(d) },
            ),
        ).toThrow(/total.*40.*сумме/s);
        expect(calls).toHaveLength(0);
    });

    it('#237 дефолтный writeFn под RALPH_NO_SIDE_EFFECTS=1 — кидает, не пишет в настоящий журнал', () => {
        // Vitest-проект ralph выставляет RALPH_NO_SIDE_EFFECTS=1 (test-setup.ts) — тест,
        // забывший инжектировать writeFn, обязан упасть, а не молча дописать строку на диск.
        expect(process.env.RALPH_NO_SIDE_EFFECTS).toBe('1');
        expect(() =>
            appendJournalEntry({
                milestone: 'Фаза 6',
                source: 'review-loop',
                pr: 1,
                counts: VALID_COUNTS,
            }),
        ).toThrow(/RALPH_NO_SIDE_EFFECTS/);
    });
});

describe('recordReviewLoopFindings', () => {
    it('считает находки PR и пишет запись source=review-loop через appendFn', () => {
        const appendCalls = [];
        const countFn = (prNumber) => {
            expect(prNumber).toBe(235);
            return VALID_COUNTS;
        };
        const appendFn = (entry, opts) => {
            appendCalls.push({ entry, opts });
            return { ts: 'stub', ...entry };
        };
        const result = recordReviewLoopFindings(235, 'Фаза 6', { countFn, appendFn });
        expect(appendCalls).toHaveLength(1);
        expect(appendCalls[0].entry).toEqual({
            milestone: 'Фаза 6',
            source: 'review-loop',
            pr: 235,
            counts: VALID_COUNTS,
        });
        expect(result.source).toBe('review-loop');
    });

    it('пустой набор находок PR (все нули) — запись пишется, не пропускается', () => {
        const zero = { blocker: 0, major: 0, minor: 0, nit: 0, unmarked: 0, total: 0 };
        const appendCalls = [];
        recordReviewLoopFindings(1, 'Фаза 6', {
            countFn: () => zero,
            appendFn: (entry) => appendCalls.push(entry),
        });
        expect(appendCalls[0].counts).toEqual(zero);
    });

    it('#237 прокидывает authorAllowlist в countFn', () => {
        let seen;
        recordReviewLoopFindings(235, 'Фаза 6', {
            countFn: (prNumber, opts) => {
                seen = opts?.authorAllowlist;
                return VALID_COUNTS;
            },
            appendFn: (entry) => entry,
            authorAllowlist: ['Pelmenya'],
        });
        expect(seen).toEqual(['Pelmenya']);
    });

    it('countFn упал (сбой gh) — throw наружу, запись не пишется (fail-closed)', () => {
        const appendCalls = [];
        expect(() =>
            recordReviewLoopFindings(1, 'Фаза 6', {
                countFn: () => {
                    throw new Error('gh api упал');
                },
                appendFn: (entry) => appendCalls.push(entry),
            }),
        ).toThrow(/gh api упал/);
        expect(appendCalls).toHaveLength(0);
    });
});

// #625: журнал различает проходы — без этого он отвечает только на «сколько находок было
// у фазы» и молчит о том, ради чего лестница ревью правок заведена: сколько дефектов
// нашлось именно в правках.
describe('recordFixReviewFindings — счёт отдельного прохода ревью правок', () => {
    it('пишет source=review-of-fixes с номером прохода и готовым счётом', () => {
        const calls = [];
        const entry = recordFixReviewFindings(42, 'Фаза 7', VALID_COUNTS, {
            pass: 2,
            appendFn: (e, o) => {
                calls.push({ e, o });
                return e;
            },
        });
        expect(calls[0].e).toEqual({
            milestone: 'Фаза 7',
            source: 'review-of-fixes',
            pr: 42,
            pass: 2,
            counts: VALID_COUNTS,
        });
        expect(entry.source).toBe('review-of-fixes');
    });

    it('счёт прохода реально доезжает до строки журнала', () => {
        const calls = [];
        recordFixReviewFindings(42, 'Фаза 7', VALID_COUNTS, {
            pass: 1,
            writeFn: undefined,
            nowFn: () => '2026-08-19T10:00:00.000Z',
            appendFn: (e, o) =>
                appendJournalEntry(e, {
                    ...o,
                    writeFn: (path, data) => calls.push(data),
                    nowFn: () => '2026-08-19T10:00:00.000Z',
                }),
        });
        expect(JSON.parse(calls[0])).toEqual({
            ts: '2026-08-19T10:00:00.000Z',
            milestone: 'Фаза 7',
            source: 'review-of-fixes',
            pr: 42,
            pass: 1,
            counts: VALID_COUNTS,
        });
    });

    it('номер прохода валидируется так же строго, как номер PR', () => {
        for (const bad of [0, -1, '2', 1.5]) {
            expect(() =>
                appendJournalEntry(
                    {
                        milestone: 'Фаза 7',
                        source: 'review-of-fixes',
                        pr: 42,
                        pass: bad,
                        counts: VALID_COUNTS,
                    },
                    { writeFn: () => {} },
                ),
            ).toThrow(/pass обязан быть положительным целым/);
        }
    });

    it('рассогласованный счёт прохода отвергается инвариантом total (метрика не врёт числом)', () => {
        expect(() =>
            recordFixReviewFindings(
                42,
                'Фаза 7',
                { blocker: 1, major: 0, minor: 0, nit: 0, unmarked: 0, total: 40 },
                { pass: 1, appendFn: (e, o) => appendJournalEntry(e, { ...o, writeFn: () => {} }) },
            ),
        ).toThrow(/total/);
    });
});
