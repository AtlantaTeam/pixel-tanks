import { describe, expect, it } from 'vitest';
import {
    countFindingsBySeverity,
    countPrFindings,
    fetchPrComments,
    parseSeverity,
    SEVERITY_LEVELS,
} from './review-findings.mjs';

// #168: счёт находок ревью петли по severity из комментариев PR. Ревью-промпт (ralph.js)
// обязывает КАЖДЫЙ комментарий начинать с метки 🔴 [blocker] / 🟠 [major] / 🟡 [minor] /
// ⚪ [nit] — парсинг опирается ровно на этот контракт, без эвристик по тексту.

describe('parseSeverity', () => {
    it.each([
        ['🔴 [blocker] сломанная физика траектории', 'blocker'],
        ['🟠 [major] N+1 запрос в лидерборде', 'major'],
        ['🟡 [minor] неймингом лучше выразить намерение', 'minor'],
        ['⚪ [nit] лишний пробел', 'nit'],
    ])('распознаёт метку %s → %s', (body, expected) => {
        expect(parseSeverity(body)).toBe(expected);
    });

    it('маркер после пробелов/переносов в начале — тоже распознаётся', () => {
        expect(parseSeverity('  \n🔴 [blocker] проблема')).toBe('blocker');
    });

    it('комментарий без метки — null, не выброс', () => {
        expect(parseSeverity('спасибо, поправил')).toBe(null);
    });

    it('маркер не в начале строки — null (контракт: метка ОБЯЗАНА быть первой)', () => {
        expect(parseSeverity('см. выше 🔴 [blocker] проблема')).toBe(null);
    });

    it('нестроковое тело — null, не выброс', () => {
        expect(parseSeverity(undefined)).toBe(null);
        expect(parseSeverity(null)).toBe(null);
    });
});

describe('countFindingsBySeverity', () => {
    it('пустой набор комментариев — все счётчики нулевые, не ошибка', () => {
        expect(countFindingsBySeverity([])).toEqual({
            blocker: 0,
            major: 0,
            minor: 0,
            nit: 0,
            unmarked: 0,
            total: 0,
        });
    });

    it('считает находки по severity, unmarked отдельно от total', () => {
        const comments = [
            '🔴 [blocker] дыра в access-контроле',
            '🔴 [blocker] сборка падает',
            '🟠 [major] пропущен edge-case',
            '🟡 [minor] стоит переименовать',
            '⚪ [nit] опечатка',
            'обычный ответ без метки',
        ];
        expect(countFindingsBySeverity(comments)).toEqual({
            blocker: 2,
            major: 1,
            minor: 1,
            nit: 1,
            unmarked: 1,
            total: 6,
        });
    });

    it('принимает как строки, так и объекты gh api с полем body', () => {
        const comments = [{ body: '🔴 [blocker] проблема' }, { body: '⚪ [nit] мелочь' }];
        const result = countFindingsBySeverity(comments);
        expect(result.blocker).toBe(1);
        expect(result.nit).toBe(1);
        expect(result.total).toBe(2);
    });

    it('объект без строкового body — unmarked, не выброс', () => {
        expect(countFindingsBySeverity([{ body: null }, {}]).unmarked).toBe(2);
    });

    it('#237 сводка ревью (isSummary) с меткой severity идёт в unmarked, не в бакет', () => {
        const comments = [
            '🔴 [blocker] реальная находка',
            { body: '🔴 [blocker] сводка прохода, дублирует находку', isSummary: true },
        ];
        const result = countFindingsBySeverity(comments);
        expect(result.blocker).toBe(1); // сводка не завысила блокеры
        expect(result.unmarked).toBe(1); // сводка ушла в unmarked
        expect(result.total).toBe(2);
    });
});

describe('SEVERITY_LEVELS', () => {
    it('фиксированный порядок blocker → major → minor → nit', () => {
        expect(SEVERITY_LEVELS).toEqual(['blocker', 'major', 'minor', 'nit']);
    });
});

// fetchPrComments: DI через spawnFn — реальный gh в тестах запрещён (#138, RALPH_NO_SIDE_EFFECTS=1
// в общем test-setup.js), поэтому spawnSync подменяется целиком.
describe('fetchPrComments', () => {
    it('некорректный номер PR — throw, не «пустой список»', () => {
        expect(() => fetchPrComments(0)).toThrow(/номер PR/);
        expect(() => fetchPrComments(-1)).toThrow(/номер PR/);
        expect(() => fetchPrComments('42')).toThrow(/номер PR/);
        expect(() => fetchPrComments(NaN)).toThrow(/номер PR/);
    });

    it('склеивает тела комментариев из issues/comments, pulls/comments и pulls/reviews', () => {
        const calls = [];
        const spawnFn = (cmd, args) => {
            calls.push(args[1]);
            if (args[1].includes('/issues/42/comments')) {
                return { status: 0, stdout: JSON.stringify([{ body: '🔴 [blocker] раз' }]) };
            }
            if (args[1].includes('/pulls/42/comments')) {
                return { status: 0, stdout: JSON.stringify([{ body: '🟡 [minor] два' }]) };
            }
            if (args[1].includes('/pulls/42/reviews')) {
                return { status: 0, stdout: JSON.stringify([{ body: '⚪ [nit] три' }]) };
            }
            throw new Error(`неожиданный endpoint: ${args[1]}`);
        };
        const bodies = fetchPrComments(42, { spawnFn });
        // #237: тела reviews помечены isSummary (в счёте идут в unmarked, не дублируют находки).
        expect(bodies).toEqual([
            '🔴 [blocker] раз',
            '🟡 [minor] два',
            { body: '⚪ [nit] три', isSummary: true },
        ]);
        expect(calls).toHaveLength(3);
    });

    it('пустые/whitespace body отфильтрованы', () => {
        const spawnFn = () => ({
            status: 0,
            stdout: JSON.stringify([{ body: '' }, { body: '   ' }, { body: null }]),
        });
        expect(fetchPrComments(1, { spawnFn })).toEqual([]);
    });

    it('#237 фильтрует по authorAllowlist — чужие комментарии не учитываются', () => {
        const spawnFn = (cmd, args) => {
            if (args[1].includes('/reviews')) return { status: 0, stdout: '[]' };
            return {
                status: 0,
                stdout: JSON.stringify([
                    { body: '🔴 [blocker] от доверенного', user: { login: 'Pelmenya' } },
                    { body: '🔴 [blocker] от прохожего', user: { login: 'random-passerby' } },
                    { body: '🟡 [minor] без user' },
                ]),
            };
        };
        // Два одинаковых endpoint'а (issues+pulls) вернут по три — фильтр оставит доверенного.
        const bodies = fetchPrComments(42, { spawnFn, authorAllowlist: ['Pelmenya'] });
        expect(bodies).toEqual(['🔴 [blocker] от доверенного', '🔴 [blocker] от доверенного']);
    });

    it('#237 пустой authorAllowlist — без фильтрации (обратная совместимость)', () => {
        const spawnFn = (cmd, args) => {
            if (args[1].includes('/reviews')) return { status: 0, stdout: '[]' };
            return {
                status: 0,
                stdout: JSON.stringify([{ body: '🔴 [blocker] x', user: { login: 'anyone' } }]),
            };
        };
        expect(fetchPrComments(42, { spawnFn }).length).toBe(2);
    });

    it('gh api упал (ненулевой код) — throw, не пустой список (fail-closed)', () => {
        const spawnFn = () => ({ status: 1, stdout: '', stderr: 'HTTP 404: Not Found' });
        expect(() => fetchPrComments(1, { spawnFn })).toThrow(/404/);
    });

    it('невалидный JSON в ответе — throw', () => {
        const spawnFn = () => ({ status: 0, stdout: 'не json' });
        expect(() => fetchPrComments(1, { spawnFn })).toThrow(/JSON/);
    });

    it('ответ не массив — throw, формат неожиданный', () => {
        const spawnFn = () => ({ status: 0, stdout: JSON.stringify({ message: 'nope' }) });
        expect(() => fetchPrComments(1, { spawnFn })).toThrow(/массив/);
    });
});

describe('countPrFindings', () => {
    it('склеивает fetch + подсчёт через инъекцию fetchFn', () => {
        const fetchFn = (prNumber) => {
            expect(prNumber).toBe(7);
            return ['🔴 [blocker] а', '🟠 [major] б'];
        };
        expect(countPrFindings(7, { fetchFn })).toEqual({
            blocker: 1,
            major: 1,
            minor: 0,
            nit: 0,
            unmarked: 0,
            total: 2,
        });
    });

    it('пустой PR (без комментариев вовсе) — нулевой счёт, не ошибка', () => {
        expect(countPrFindings(7, { fetchFn: () => [] })).toEqual({
            blocker: 0,
            major: 0,
            minor: 0,
            nit: 0,
            unmarked: 0,
            total: 0,
        });
    });
});
