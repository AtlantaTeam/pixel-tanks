import { describe, expect, it, vi } from 'vitest';
import {
    addIssueToBoard,
    addMissingIssues,
    fetchBoard,
    fetchOpenIssues,
    isClosed,
    markDone,
    pickStale,
    resolveBoard,
    resolveDone,
    resolveRepo,
    runGh,
    runSync,
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

const item = (id, number, typename, state, optionId, extra = {}) => ({
    id,
    isArchived: false,
    content: { __typename: typename, number, state },
    fieldValues: {
        pageInfo: { hasNextPage: false },
        nodes: optionId
            ? [{ optionId, field: { name: 'Status' } }]
            : [{ field: { name: 'Labels' } }],
    },
    ...extra,
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

    it('черновик доски пропускает молча — у него нет состояния, синкать нечего', () => {
        expect(isClosed({ __typename: 'DraftIssue' })).toBe(false);
        expect(isClosed(undefined)).toBe(false);
    });

    it('бросает на незнакомом типе карточки — судить о нём синк не берётся', () => {
        expect(() => isClosed({ __typename: 'Discussion', state: 'CLOSED' })).toThrow(
            /незнакомый тип карточки "Discussion"/,
        );
    });

    it('бросает на незнакомом состоянии — enum GitHub изменился, молчать нельзя', () => {
        expect(() => isClosed({ __typename: 'Issue', number: 7, state: 'closed' })).toThrow(
            /Issue #7 в незнакомом состоянии "closed"/,
        );
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

    it('архивную карточку не трогает — мутацию по ней API отвергнет', () => {
        const items = [item('i1', 80, 'Issue', 'CLOSED', 'opt-wip', { isArchived: true })];
        expect(pickStale(items, doneOption.id)).toEqual([]);
    });

    it('бросает, когда значения полей карточки усечены — Status мог не попасть', () => {
        const truncated = item('i1', 80, 'Issue', 'CLOSED', 'opt-wip');
        truncated.fieldValues.pageInfo.hasNextPage = true;
        expect(() => pickStale([truncated], doneOption.id)).toThrow(/сверка ненадёжна/);
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

describe('resolveBoard — адрес доски из env/конфига, fail-closed (#204)', () => {
    // readFn(configPath, 'utf-8') — мок игнорирует путь, отдаёт синтетический ralph.config.json.
    const readCfg = (board) => () => JSON.stringify({ common: board ? { board } : {} });

    it('берёт owner/number из common.board конфига, когда env пуст', () => {
        expect(resolveBoard({ env: {}, readFn: readCfg({ owner: 'AcmeOrg', number: 7 }) })).toEqual(
            { owner: 'AcmeOrg', number: 7 },
        );
    });

    it('env RALPH_BOARD_* важнее конфига (быстрый оверрайд под другой проект)', () => {
        expect(
            resolveBoard({
                env: { RALPH_BOARD_OWNER: 'EnvOrg', RALPH_BOARD_NUMBER: '42' },
                readFn: readCfg({ owner: 'CfgOrg', number: 1 }),
            }),
        ).toEqual({ owner: 'EnvOrg', number: 42 });
    });

    it('нет owner ни в env, ни в конфиге → throw (молча чужую доску не синкаем)', () => {
        expect(() => resolveBoard({ env: {}, readFn: readCfg(null) })).toThrow(
            /owner доски не задан/,
        );
    });

    it('битый/отсутствующий конфиг + пустой env → throw', () => {
        const boom = () => {
            throw new Error('ENOENT');
        };
        expect(() => resolveBoard({ env: {}, readFn: boom })).toThrow(/owner доски не задан/);
    });

    it('#204-ревью: задан только RALPH_BOARD_OWNER (без number) → берём ОБЕ из конфига, не кентавр', () => {
        // Полу-заданный env не смешивается с конфигом: owner из env + number из конфига дал
        // бы адрес чужой доски. Обе env заданы → env; иначе обе из конфига.
        expect(
            resolveBoard({
                env: { RALPH_BOARD_OWNER: 'TestOrg' },
                readFn: readCfg({ owner: 'CfgOrg', number: 5 }),
            }),
        ).toEqual({ owner: 'CfgOrg', number: 5 });
    });

    it('#204-ревью: пустые строки в env трактуются как «не задано» одинаково (owner и number)', () => {
        expect(
            resolveBoard({
                env: { RALPH_BOARD_OWNER: '', RALPH_BOARD_NUMBER: '' },
                readFn: readCfg({ owner: 'CfgOrg', number: 9 }),
            }),
        ).toEqual({ owner: 'CfgOrg', number: 9 });
    });

    it('owner есть, но номер не целое > 0 → throw (fail-closed на кривом номере)', () => {
        expect(() =>
            resolveBoard({ env: {}, readFn: readCfg({ owner: 'AcmeOrg', number: 0 }) }),
        ).toThrow(/номер доски/);
        expect(() =>
            resolveBoard({
                env: { RALPH_BOARD_OWNER: 'A', RALPH_BOARD_NUMBER: 'abc' },
                readFn: readCfg(null),
            }),
        ).toThrow(/номер доски/);
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

    it('бросает, когда пагинация не сходится — защита от бесконечного цикла', () => {
        const ghFn = vi.fn(() => page([], { hasNextPage: true, endCursor: 'cur' }));
        expect(() => fetchBoard(ghFn)).toThrow(/не сошлась за 50 страниц/);
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

    it('парсит JSON успешного ответа и ставит таймаут — повисший gh не вешает прогон', () => {
        const spawnFn = vi.fn().mockReturnValue({ status: 0, stdout: '{"data":{"ok":true}}' });
        expect(runGh(['api', 'graphql'], spawnFn)).toEqual({ data: { ok: true } });
        expect(spawnFn.mock.calls[0][2].timeout).toBeGreaterThan(0);
    });

    it('не теряет диагностику, когда stderr пуст — сообщение не обрывается', () => {
        const spawnFn = vi.fn().mockReturnValue({ status: 3, stdout: '', stderr: '' });
        expect(() => runGh(['api', 'graphql'], spawnFn)).toThrow(/код 3/);
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

    it('ошибка мутации доходит наружу, а уже применённые правки не откатываются', () => {
        const items = [
            item('i1', 80, 'Issue', 'CLOSED', 'opt-wip'),
            item('i2', 81, 'Issue', 'CLOSED', 'opt-wip'),
        ];
        const logFn = vi.fn();
        const ghFn = vi
            .fn()
            .mockReturnValueOnce(page(items))
            .mockReturnValueOnce({ data: {} })
            .mockImplementationOnce(() => {
                throw new Error('secondary rate limit');
            });

        expect(() => syncBoard({ ghFn, logFn })).toThrow(/secondary rate limit/);
        expect(logFn).toHaveBeenCalledTimes(1); // первая карточка успела примениться
    });

    it('не мутирует ничего, когда доска отдала непонятный формат', () => {
        const ghFn = vi.fn().mockReturnValue(page([], { field: null }));
        expect(() => syncBoard({ ghFn, logFn: vi.fn() })).toThrow(/нет single-select поля/);
        expect(ghFn).toHaveBeenCalledTimes(1);
    });
});

// #90: второй проход синка — открытые issues, заведённые мимо доски. Свойства те же, что
// у синка статусов, и проверяются так же: он не делает лишних мутаций (идемпотентность) и
// краснеет на данных, которым нельзя верить (fail-closed), — молчаливое «проверено 30 из
// 300» здесь такой же отказ, как несинхронизированная доска в #199.

const issueItem = (itemId, number, nodeId, extra = {}) => ({
    id: itemId,
    isArchived: false,
    content: { __typename: 'Issue', id: nodeId, number, state: 'OPEN' },
    fieldValues: { pageInfo: { hasNextPage: false }, nodes: [] },
    ...extra,
});

describe('resolveRepo — адрес репо детерминирован, не от cwd (#90)', () => {
    const spawnOk = (stdout) => vi.fn().mockReturnValue({ status: 0, stdout });

    it('берёт RALPH_REPO из env, git не зовёт вовсе', () => {
        const spawnFn = vi.fn();
        expect(resolveRepo({ env: { RALPH_REPO: 'Some/repo' }, spawnFn })).toBe('Some/repo');
        expect(spawnFn).not.toHaveBeenCalled();
    });

    it('разбирает origin во всех трёх формах записи', () => {
        for (const [url, expected] of [
            ['git@github.com:Owner/repo.git\n', 'Owner/repo'],
            ['https://github.com/Owner/repo.git\n', 'Owner/repo'],
            ['ssh://git@github.com/Owner/repo\n', 'Owner/repo'],
        ]) {
            expect(resolveRepo({ env: {}, spawnFn: spawnOk(url) })).toBe(expected);
        }
    });

    it('спрашивает git по каталогу скрипта, а не по cwd', () => {
        const spawnFn = spawnOk('git@github.com:Owner/repo.git');
        resolveRepo({ env: {}, repoRoot: '/srv/checkout', spawnFn });
        expect(spawnFn.mock.calls[0][1]).toEqual([
            '-C',
            '/srv/checkout',
            'remote',
            'get-url',
            'origin',
        ]);
    });

    it('падает, когда origin не прочитан: угадывать чужой репозиторий нельзя', () => {
        const spawnFn = vi.fn().mockReturnValue({ status: 128, stdout: '', stderr: 'no origin' });
        expect(() => resolveRepo({ env: {}, spawnFn })).toThrow(/не прочитан origin/);
    });

    it('падает на мусоре вместо owner/name — и в env, и в origin', () => {
        expect(() => resolveRepo({ env: { RALPH_REPO: 'просто-имя' }, spawnFn: vi.fn() })).toThrow(
            /RALPH_REPO/,
        );
        expect(() => resolveRepo({ env: {}, spawnFn: spawnOk('нечто-без-слэша') })).toThrow(
            /не читается как owner\/name/,
        );
    });
});

describe('fetchOpenIssues', () => {
    it('всегда шлёт --limit: дефолт gh — 30 карточек молча', () => {
        const ghFn = vi.fn().mockReturnValue([]);
        fetchOpenIssues({ repo: 'Owner/repo' }, ghFn);
        const args = ghFn.mock.calls[0][0];
        const at = args.indexOf('--limit');
        expect(at, 'выборка без --limit обрезалась бы на 30').toBeGreaterThan(-1);
        expect(Number(args[at + 1])).toBeGreaterThanOrEqual(1000);
        expect(args.join(' ')).toContain('--repo Owner/repo');
        expect(args.join(' ')).toContain('--state open');
    });

    it('упор в потолок выборки — отказ, а не молчаливое усечение', () => {
        const ghFn = vi
            .fn()
            .mockReturnValue(Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` })));
        expect(() => fetchOpenIssues({ repo: 'Owner/repo', limit: 5 }, ghFn)).toThrow(
            /потолка выборки/,
        );
    });

    it('не список вместо выборки — отказ: формат вывода gh изменился', () => {
        const ghFn = vi.fn().mockReturnValue({ issues: [] });
        expect(() => fetchOpenIssues({ repo: 'Owner/repo' }, ghFn)).toThrow(/не список/);
    });
});

describe('addIssueToBoard', () => {
    it('шлёт мутацию добавления с node-id issue', () => {
        const ghFn = vi.fn().mockReturnValue({ data: {} });
        addIssueToBoard('I_node1', { projectId: 'proj-1' }, ghFn);
        const args = ghFn.mock.calls[0][0];
        expect(args.join(' ')).toContain('addProjectV2ItemById');
        expect(args.join(' ')).toContain('contentId=I_node1');
        for (const name of ['project', 'contentId']) {
            const at = args.findIndex((a) => a.startsWith(`${name}=`));
            expect(args[at - 1], `${name} должен передаваться через -f`).toBe('-f');
        }
    });
});

describe('addMissingIssues', () => {
    const board = (items) => ({ projectId: 'proj-1', items });

    it('добавляет только те issues, которых на доске нет', () => {
        const ghFn = vi
            .fn()
            .mockReturnValueOnce([
                { number: 90, id: 'I_a' },
                { number: 91, id: 'I_b' },
            ])
            .mockReturnValue({ data: {} });
        const logFn = vi.fn();

        expect(
            addMissingIssues({
                ghFn,
                board: board([issueItem('it1', 90, 'I_a')]),
                repo: 'O/r',
                logFn,
            }),
        ).toEqual({ checked: 2, added: 1 });
        expect(ghFn).toHaveBeenCalledTimes(2); // выборка issues + одна мутация
        expect(logFn).toHaveBeenCalledWith(expect.stringContaining('#91'));
    });

    it('идемпотентность: всё уже на доске — ни одной мутации', () => {
        const ghFn = vi.fn().mockReturnValue([{ number: 90, id: 'I_a' }]);
        expect(
            addMissingIssues({
                ghFn,
                board: board([issueItem('it1', 90, 'I_a')]),
                repo: 'O/r',
                logFn: vi.fn(),
            }),
        ).toEqual({ checked: 1, added: 0 });
        expect(ghFn).toHaveBeenCalledTimes(1); // только выборка issues
    });

    it('пустой репозиторий — нули и ни одной мутации', () => {
        const ghFn = vi.fn().mockReturnValue([]);
        expect(addMissingIssues({ ghFn, board: board([]), repo: 'O/r', logFn: vi.fn() })).toEqual({
            checked: 0,
            added: 0,
        });
        expect(ghFn).toHaveBeenCalledTimes(1);
    });

    it('сверяет по node-id, а не по номеру: чужой #90 на доске не скрывает свой', () => {
        const ghFn = vi
            .fn()
            .mockReturnValueOnce([{ number: 90, id: 'I_свой' }])
            .mockReturnValue({ data: {} });
        expect(
            addMissingIssues({
                ghFn,
                board: board([issueItem('it1', 90, 'I_чужой')]),
                repo: 'O/r',
                logFn: vi.fn(),
            }),
        ).toEqual({ checked: 1, added: 1 });
    });

    it('архивную карточку считает присутствующей: архив — решение человека', () => {
        const ghFn = vi.fn().mockReturnValue([{ number: 90, id: 'I_a' }]);
        expect(
            addMissingIssues({
                ghFn,
                board: board([issueItem('it1', 90, 'I_a', { isArchived: true })]),
                repo: 'O/r',
                logFn: vi.fn(),
            }),
        ).toEqual({ checked: 1, added: 0 });
        expect(ghFn).toHaveBeenCalledTimes(1);
    });

    it('ошибка gh доходит наружу — fail-closed, а не «добавлять нечего»', () => {
        const ghFn = vi.fn().mockImplementation(() => {
            throw new Error('HTTP 403 forbidden');
        });
        expect(() =>
            addMissingIssues({ ghFn, board: board([]), repo: 'O/r', logFn: vi.fn() }),
        ).toThrow(/403/);
    });

    it('без готовой доски читает её сам — функция остаётся вызываемой отдельно', () => {
        const ghFn = vi.fn().mockReturnValueOnce(page([])).mockReturnValueOnce([]);
        expect(
            addMissingIssues({ ghFn, owner: 'O', number: 1, repo: 'O/r', logFn: vi.fn() }),
        ).toEqual({ checked: 0, added: 0 });
    });
});

describe('runSync — оба прохода за одно чтение доски, сводка одной строкой', () => {
    it('читает доску один раз на оба прохода', () => {
        const ghFn = vi
            .fn()
            .mockReturnValueOnce(page([item('i1', 80, 'Issue', 'CLOSED', 'opt-wip')]))
            .mockReturnValueOnce({ data: {} }) // markDone
            .mockReturnValueOnce([]); // выборка открытых issues
        runSync({ ghFn, owner: 'O', number: 1, repo: 'O/r', logFn: vi.fn() });
        const boardReads = ghFn.mock.calls.filter((c) => c[0].join(' ').includes('projectV2('));
        expect(boardReads).toHaveLength(1);
    });

    it('сводка возвращается (её печатает вызывающий последней), а не теряется среди логов', () => {
        const logs = [];
        const ghFn = vi
            .fn()
            .mockReturnValueOnce(page([item('i1', 80, 'Issue', 'CLOSED', 'opt-wip')]))
            .mockReturnValueOnce({ data: {} })
            .mockReturnValueOnce([{ number: 91, id: 'I_b' }])
            .mockReturnValueOnce({ data: {} });
        const summary = runSync({
            ghFn,
            owner: 'O',
            number: 1,
            repo: 'O/r',
            logFn: (m) => logs.push(m),
        });
        expect(summary).toContain('переведено — 1');
        expect(summary).toContain('добавлено на доску — 1');
        expect(logs.every((l) => !l.includes('project-sync:'))).toBe(true);
    });

    it('на приведённой доске отчитывается нулями, а не молчит', () => {
        const ghFn = vi.fn().mockReturnValueOnce(page([])).mockReturnValueOnce([]);
        expect(runSync({ ghFn, owner: 'O', number: 1, repo: 'O/r', logFn: vi.fn() })).toContain(
            'добавлено на доску — 0',
        );
    });
});
