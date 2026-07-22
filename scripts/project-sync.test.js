import { describe, expect, it, vi } from 'vitest';
import {
    fetchBoard,
    isClosed,
    markDone,
    pickStale,
    resolveDone,
    runGh,
    syncBoard,
} from './project-sync.mjs';

// #199: доска расходилась с реальностью молча — встроенная автоматизация Projects
// срабатывала не для всех карточек и об этом не сообщала. Тесты держат два свойства,
// без которых синк бесполезен: он не трогает лишнего (идемпотентность, открытые
// issues) и краснеет на любых данных, которым нельзя верить (fail-closed).

const doneOption = { id: 'opt-done', name: 'Done' };
const todoOption = { id: 'opt-todo', name: 'Todo' };
const statusField = {
    id: 'field-status',
    options: [todoOption, { id: 'opt-wip', name: 'In Progress' }, doneOption],
};

const item = (id, number, typename, state, optionId) => ({
    id,
    content: { __typename: typename, number, state },
    fieldValues: {
        nodes: optionId
            ? [{ optionId, field: { name: 'Status' } }]
            : [{ field: { name: 'Labels' } }],
    },
});

const page = (nodes, { hasNextPage = false, endCursor = null, field = statusField } = {}) => ({
    data: {
        organization: {
            projectV2: {
                id: 'proj-1',
                field,
                items: { pageInfo: { hasNextPage, endCursor }, nodes },
            },
        },
    },
});

describe('isClosed', () => {
    it('считает закрытым CLOSED issue и CLOSED/MERGED pull request', () => {
        expect(isClosed({ __typename: 'Issue', state: 'CLOSED' })).toBe(true);
        expect(isClosed({ __typename: 'PullRequest', state: 'MERGED' })).toBe(true);
        expect(isClosed({ __typename: 'PullRequest', state: 'CLOSED' })).toBe(true);
    });

    it('не считает закрытым открытый issue', () => {
        expect(isClosed({ __typename: 'Issue', state: 'OPEN' })).toBe(false);
    });

    it('незнакомый тип контента закрытым не считает — черновик доски не трогаем', () => {
        expect(isClosed({ __typename: 'DraftIssue', state: 'CLOSED' })).toBe(false);
        expect(isClosed(undefined)).toBe(false);
    });
});

describe('pickStale', () => {
    it('берёт закрытый issue, который висит не в Done', () => {
        const items = [item('i1', 80, 'Issue', 'CLOSED', 'opt-wip')];
        expect(pickStale(items, doneOption.id).map((i) => i.content.number)).toEqual([80]);
    });

    it('закрытый issue без выставленного статуса тоже берёт', () => {
        const items = [item('i1', 81, 'Issue', 'CLOSED', null)];
        expect(pickStale(items, doneOption.id)).toHaveLength(1);
    });

    it('идемпотентность: карточка уже в Done в правку не попадает', () => {
        const items = [item('i1', 82, 'Issue', 'CLOSED', doneOption.id)];
        expect(pickStale(items, doneOption.id)).toEqual([]);
    });

    it('открытый issue не трогает, даже если он в Todo', () => {
        const items = [item('i1', 53, 'Issue', 'OPEN', todoOption.id)];
        expect(pickStale(items, doneOption.id)).toEqual([]);
    });
});

describe('resolveDone', () => {
    it('возвращает id поля и опции Done', () => {
        expect(resolveDone(statusField)).toEqual({
            fieldId: 'field-status',
            doneOptionId: 'opt-done',
        });
    });

    it('бросает, когда поля Status на доске нет — доску перенастроили', () => {
        expect(() => resolveDone(null)).toThrow(/нет single-select поля "Status"/);
    });

    it('бросает, когда у Status нет опции Done, и называет доступные', () => {
        expect(() => resolveDone({ id: 'f', options: [todoOption] })).toThrow(/есть: Todo/);
    });
});

describe('fetchBoard', () => {
    it('собирает карточки со всех страниц пагинации', () => {
        const ghFn = vi
            .fn()
            .mockReturnValueOnce(
                page([item('i1', 1, 'Issue', 'CLOSED', doneOption.id)], {
                    hasNextPage: true,
                    endCursor: 'cur-1',
                }),
            )
            .mockReturnValueOnce(page([item('i2', 2, 'Issue', 'CLOSED', 'opt-wip')]));
        const board = fetchBoard(ghFn);
        expect(board.items).toHaveLength(2);
        expect(board.projectId).toBe('proj-1');
        expect(ghFn.mock.calls[1][0].join(' ')).toContain('cursor=cur-1');
    });

    it('бросает, когда ответ без projectV2 — чужая доска или нет прав', () => {
        const ghFn = vi.fn().mockReturnValue({ data: { organization: null } });
        expect(() => fetchBoard(ghFn)).toThrow(/не прочитана/);
    });

    it('бросает на ответе без items.nodes — формат API изменился', () => {
        const ghFn = vi.fn().mockReturnValue({
            data: { organization: { projectV2: { id: 'p', field: statusField } } },
        });
        expect(() => fetchBoard(ghFn)).toThrow(/формат Projects API изменился/);
    });

    it('бросает, когда hasNextPage=true без курсора — пагинация ненадёжна', () => {
        const ghFn = vi.fn().mockReturnValue(page([], { hasNextPage: true, endCursor: null }));
        expect(() => fetchBoard(ghFn)).toThrow(/без endCursor/);
    });
});

describe('runGh', () => {
    it('бросает с текстом stderr, когда gh упал', () => {
        const spawnFn = vi.fn().mockReturnValue({ status: 1, stdout: '', stderr: 'HTTP 401' });
        expect(() => runGh(['api', 'graphql'], spawnFn)).toThrow(/HTTP 401/);
    });

    it('бросает, когда gh вернул пустой вывод при нулевом коде', () => {
        const spawnFn = vi.fn().mockReturnValue({ status: 0, stdout: '' });
        expect(() => runGh(['api', 'graphql'], spawnFn)).toThrow(/не вернул вывод/);
    });
});

describe('markDone', () => {
    it('шлёт мутацию с id карточки, поля и опции', () => {
        const ghFn = vi.fn().mockReturnValue({ data: {} });
        markDone(
            item('i1', 80, 'Issue', 'CLOSED', 'opt-wip'),
            {
                projectId: 'proj-1',
                fieldId: 'field-status',
                doneOptionId: 'opt-done',
            },
            ghFn,
        );
        const args = ghFn.mock.calls[0][0].join(' ');
        expect(args).toContain('item=i1');
        expect(args).toContain('option=opt-done');
        expect(args).toContain('updateProjectV2ItemFieldValue');
    });

    it('строковые переменные идут через -f, а не -F: gh отвергает String! в типизированном флаге', () => {
        const ghFn = vi.fn().mockReturnValue({ data: {} });
        markDone(
            item('i1', 80, 'Issue', 'CLOSED', 'opt-wip'),
            { projectId: 'proj-1', fieldId: 'field-status', doneOptionId: 'opt-done' },
            ghFn,
        );
        const args = ghFn.mock.calls[0][0];
        for (const name of ['project', 'item', 'field', 'option']) {
            const at = args.findIndex((a) => a.startsWith(`${name}=`));
            expect(args[at - 1], `${name} должен передаваться через -f`).toBe('-f');
        }
    });
});

describe('syncBoard', () => {
    it('правит только просроченные карточки и отчитывается числами', () => {
        const items = [
            item('i1', 80, 'Issue', 'CLOSED', 'opt-wip'),
            item('i2', 82, 'Issue', 'CLOSED', doneOption.id),
            item('i3', 53, 'Issue', 'OPEN', todoOption.id),
        ];
        const ghFn = vi.fn().mockReturnValueOnce(page(items)).mockReturnValue({ data: {} });
        const logFn = vi.fn();

        expect(syncBoard({ ghFn, logFn })).toEqual({ scanned: 3, updated: 1 });
        expect(ghFn).toHaveBeenCalledTimes(2); // 1 чтение + 1 мутация
        expect(logFn).toHaveBeenCalledWith(expect.stringContaining('#80'));
    });

    it('идемпотентность: на приведённой доске не делает ни одной мутации', () => {
        const ghFn = vi
            .fn()
            .mockReturnValue(page([item('i1', 82, 'Issue', 'CLOSED', doneOption.id)]));

        expect(syncBoard({ ghFn, logFn: vi.fn() })).toEqual({ scanned: 1, updated: 0 });
        expect(ghFn).toHaveBeenCalledTimes(1); // только чтение
    });

    it('не мутирует ничего, когда доска отдала непонятный формат', () => {
        const ghFn = vi.fn().mockReturnValue(page([], { field: null }));
        expect(() => syncBoard({ ghFn, logFn: vi.fn() })).toThrow(/нет single-select поля/);
        expect(ghFn).toHaveBeenCalledTimes(1);
    });
});
