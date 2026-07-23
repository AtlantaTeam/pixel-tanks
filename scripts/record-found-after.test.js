import { describe, expect, it } from 'vitest';
import { recordFoundAfter, parseFoundAfterArgs } from './record-found-after.mjs';

// #170: дешёвый шаг фиксации находок «найдено после» (ручная половина метрики).
// Интерфейс CLI: node scripts/record-found-after.mjs <milestone> <blocker> <major> <minor> <nit> [--pr <N>]

describe('parseFoundAfterArgs', () => {
    it('парсит базовые аргументы: milestone и четыре счётчика severity', () => {
        const result = parseFoundAfterArgs(['node', 'script.mjs', 'Фаза 6', '1', '2', '0', '3']);
        expect(result).toEqual({
            milestone: 'Фаза 6',
            blocker: 1,
            major: 2,
            minor: 0,
            nit: 3,
            pr: null,
        });
    });

    it('парсит --pr флаг', () => {
        const result = parseFoundAfterArgs([
            'node',
            'script.mjs',
            'Фаза 6',
            '1',
            '2',
            '0',
            '3',
            '--pr',
            '235',
        ]);
        expect(result.pr).toBe(235);
    });

    it('--pr может быть omit (pr=null) — находка из разбора целой фазы, не конкретного PR', () => {
        const result = parseFoundAfterArgs(['node', 'script.mjs', 'Фаза 6', '1', '2', '0', '3']);
        expect(result.pr).toBeNull();
    });

    it('счётчики должны быть неотрицательными целыми', () => {
        expect(() =>
            parseFoundAfterArgs(['node', 'script.mjs', 'Фаза 6', '-1', '0', '0', '0']),
        ).toThrow(/неотрицательным/);

        expect(() =>
            parseFoundAfterArgs(['node', 'script.mjs', 'Фаза 6', '1.5', '0', '0', '0']),
        ).toThrow(/неотрицательным/);
    });

    it('milestone должен быть непустой строкой', () => {
        expect(() => parseFoundAfterArgs(['node', 'script.mjs', '', '0', '0', '0', '0'])).toThrow(
            /milestone/,
        );
    });

    it('--pr должен быть положительным целым если указан', () => {
        expect(() =>
            parseFoundAfterArgs(['node', 'script.mjs', 'Фаза 6', '0', '0', '0', '0', '--pr', '0']),
        ).toThrow(/--pr.*положительным/);

        expect(() =>
            parseFoundAfterArgs([
                'node',
                'script.mjs',
                'Фаза 6',
                '0',
                '0',
                '0',
                '0',
                '--pr',
                'abc',
            ]),
        ).toThrow(/--pr.*целым/);
    });

    it('недостаточно аргументов — throw', () => {
        expect(
            () => parseFoundAfterArgs(['node', 'script.mjs', 'Фаза 6']), // только milestone
        ).toThrow();
    });

    it('#237 без nit (пять позиционных, длина argv 6) — throw на usage, не на «nit undefined»', () => {
        // milestone + blocker/major/minor = argv[2..5], nit пропущен. Раньше guard был < 6
        // и вызов доходил до parseNonNegative(undefined) — падал не на честном usage.
        expect(() => parseFoundAfterArgs(['node', 'script.mjs', 'Фаза 6', '1', '2', '0'])).toThrow(
            /Укажи/,
        );
    });

    it('#237 --pr последним без значения — throw, не тихий pr=null', () => {
        expect(() =>
            parseFoundAfterArgs(['node', 'script.mjs', 'Фаза 6', '1', '2', '0', '3', '--pr']),
        ).toThrow(/--pr требует значение/);
    });
});

describe('recordFoundAfter', () => {
    it('создаёт запись source=found-after и вызывает appendFn', () => {
        const appendCalls = [];
        const appendFn = (entry, opts) => {
            appendCalls.push({ entry, opts });
            return { ts: 'stub', ...entry };
        };
        const result = recordFoundAfter(
            {
                milestone: 'Фаза 6',
                blocker: 1,
                major: 2,
                minor: 0,
                nit: 3,
                pr: null,
            },
            { appendFn },
        );

        expect(appendCalls).toHaveLength(1);
        expect(appendCalls[0].entry).toEqual({
            milestone: 'Фаза 6',
            source: 'found-after',
            pr: null,
            counts: { blocker: 1, major: 2, minor: 0, nit: 3, unmarked: 0, total: 6 },
        });
        expect(result.source).toBe('found-after');
    });

    it('вычисляет unmarked и total из остальных счётчиков', () => {
        const appendCalls = [];
        const appendFn = (entry) => appendCalls.push(entry);
        recordFoundAfter(
            {
                milestone: 'Фаза 6',
                blocker: 2,
                major: 3,
                minor: 1,
                nit: 4,
                pr: 235,
            },
            { appendFn },
        );

        const counts = appendCalls[0].counts;
        expect(counts.unmarked).toBe(0); // все находки размечены
        expect(counts.total).toBe(2 + 3 + 1 + 4);
    });

    it('appendFn упал — throw наружу', () => {
        const appendFn = () => {
            throw new Error('запись в диск упала');
        };
        expect(() =>
            recordFoundAfter(
                {
                    milestone: 'Фаза 6',
                    blocker: 0,
                    major: 0,
                    minor: 0,
                    nit: 0,
                    pr: null,
                },
                { appendFn },
            ),
        ).toThrow(/запись в диск упала/);
    });
});
