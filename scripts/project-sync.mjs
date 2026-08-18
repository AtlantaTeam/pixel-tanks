#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// #199: синк доски GitHub Projects с реальным состоянием issues.
//
// Наблюдение 2026-07-22: на доске накопилось 13 закрытых issues (#76–#88) в статусе
// «In Progress» — переводили руками. Причина: раннер доску не трогает вовсе, а
// встроенная автоматизация Projects («Item closed») срабатывает не для всех карточек
// (#130 закрыт 21.07 12:00 → Done, #80 закрыт 13:51 → остался In Progress) и молчит,
// когда не сработала. Доска расходится с реальностью до тех пор, пока человек не
// заметит, — то есть проверка существует только в голове человека.
//
// Барьер вместо ритуала: детерминированный проход, приводящий Status закрытых карточек
// к Done. Идемпотентен — карточка уже в Done не порождает ни одной мутации.
//
// #204: owner/номер доски больше НЕ прибиты к проекту (был 'AtlantaTeam'/1). Их даёт
// resolveBoard из env (RALPH_BOARD_OWNER/RALPH_BOARD_NUMBER) или ralph.config.json
// (common.board), fail-closed при отсутствии: молча синкнуть ЧУЖУЮ доску (или ничью) —
// хуже, чем честно упасть с просьбой заполнить конфиг.
const STATUS_FIELD = 'Status';
const DONE_OPTION = 'Done';

// Путь к конфигу раннера от расположения скрипта (scripts/ и .claude/ — соседи в корне
// репо), а не от cwd: project:sync зовётся и раннером, и человеком из разных мест.
const CONFIG_PATH = fileURLToPath(new URL('../.claude/ralph/ralph.config.json', import.meta.url));

// Корень репозитория — оттуда же, от расположения скрипта (scripts/ лежит в корне), а не
// от cwd: по нему резолвится адрес репозитория (resolveRepo), и он обязан быть одним и
// тем же, откуда бы скрипт ни звали.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Потолок выборки открытых issues. Не бизнес-лимит, а страховка: `gh issue list` без
// --limit отдаёт МОЛЧА первые 30 (дефолт CLI), то есть проход отчитался бы успехом,
// не увидев большей части репозитория, — ровно тот молчаливый отказ, ради которого
// написана пагинация доски. Упор в потолок ниже — throw, а не усечение.
const OPEN_ISSUES_LIMIT = 1000;

// Резолв доски: env важнее конфига (быстрый оверрайд под другой проект без правки файла),
// иначе common.board из ralph.config.json. Отсутствие owner ИЛИ невалидный номер — throw
// (fail-closed): без адреса доски синкать нечего, а угадывать чужую нельзя.
//
// Адрес берётся ЦЕЛИКОМ из одного источника — env ИЛИ конфиг, без смешения (#204-ревью):
// «owner из env, number из конфига» дал бы адрес-кентавр. Сценарий: человек задал
// RALPH_BOARD_OWNER=TestOrg для эксперимента, забыл про number → синк ушёл бы в чужую
// доску с номером из конфига (ровно «чужая доска», от которой этот код и защищается).
// Пустая строка = «не задано» для обеих переменных ОДИНАКОВО: иначе RALPH_BOARD_NUMBER=""
// (не nullish) не смотрел бы в конфиг и валил Number('')→0→throw, а RALPH_BOARD_OWNER=""
// (falsy) тихо падал в конфиг — асимметрия. Обе env-переменные непусты → env; иначе обе
// из конфига.
//
// ВНИМАНИЕ (#204-ревью): читается только `common.board`, БЕЗ resolveProfile/deepMerge —
// скрипт живёт вне раннера и профиля не знает. `board` в `profiles.<name>` синк НЕ увидит
// (положишь его туда — упадёт «owner не задан», хотя конфиг с виду валиден). Держи `board`
// только в `common`. Зафиксировано в docs/ralph-mini-framework/porting-checklist.md §4.
export function resolveBoard({
    env = process.env,
    configPath = CONFIG_PATH,
    readFn = readFileSync,
} = {}) {
    const envOwner = typeof env.RALPH_BOARD_OWNER === 'string' ? env.RALPH_BOARD_OWNER : '';
    const envNumber = typeof env.RALPH_BOARD_NUMBER === 'string' ? env.RALPH_BOARD_NUMBER : '';
    let owner;
    let number;
    if (envOwner && envNumber) {
        owner = envOwner;
        number = envNumber;
    } else {
        let board = {};
        try {
            board = JSON.parse(readFn(configPath, 'utf-8'))?.common?.board ?? {};
        } catch {
            // Нет/битый конфиг — fail-closed сработает ниже на пустых owner/number.
        }
        owner = board.owner;
        number = board.number;
    }
    if (!owner || typeof owner !== 'string') {
        throw new Error(
            'owner доски не задан: заполни RALPH_BOARD_OWNER (env) или common.board.owner в ralph.config.json',
        );
    }
    const num = Number(number);
    if (!Number.isInteger(num) || num <= 0) {
        throw new Error(
            'номер доски не задан/некорректен: заполни RALPH_BOARD_NUMBER (env) или common.board.number (целое > 0)',
        );
    }
    return { owner, number: num };
}

// Адрес репозитория (`owner/name`) для выборки открытых issues. Резолвится ДЕТЕРМИНИРОВАННО,
// а не от cwd (#90-ревью): `gh repo view` без `--repo` смотрит на текущий каталог, а скрипт
// зовут и раннер из своего дерева, и человек из произвольного места — из домашнего каталога
// такой вызов молча ушёл бы в ЧУЖОЙ репозиторий либо отвалился. Источник тот же, что у
// CONFIG_PATH: отсчёт от import.meta.url, то есть от дерева, в котором лежит сам скрипт.
//
// Владельца ДОСКИ (resolveBoard) для склейки адреса не переиспользуем сознательно: доска
// организации + форк в личном аккаунте — штатная пара, и `${owner доски}/${имя репо}` дал
// бы адрес-кентавр ровно того класса, от которого защищается resolveBoard (#204-ревью).
//
// RALPH_REPO (env) важнее origin — оверрайд под нестандартную раскладку без правки кода,
// той же формы `owner/name`. Не распарсили ни то ни другое — throw (fail-closed): выбрать
// репозиторий наугад хуже, чем честно попросить задать переменную.
export function resolveRepo({ env = process.env, repoRoot = REPO_ROOT, spawnFn = spawnSync } = {}) {
    const fromEnv = typeof env.RALPH_REPO === 'string' ? env.RALPH_REPO.trim() : '';
    if (fromEnv) return assertFullName(fromEnv, 'RALPH_REPO');
    const result = spawnFn('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], {
        encoding: 'utf8',
        timeout: 30_000,
    });
    if (result.status !== 0 || !result.stdout) {
        const why = result.error?.message || result.stderr?.trim() || `код ${result.status}`;
        throw new Error(
            `не прочитан origin репозитория (${repoRoot}): ${why}; задай RALPH_REPO=owner/name`,
        );
    }
    return assertFullName(parseRemoteUrl(result.stdout.trim()), 'origin');
}

// Формы origin, которые обязаны разобраться одинаково: scp-подобная (git@host:owner/name.git),
// https (https://host/owner/name.git) и ssh:// (ssh://git@host/owner/name). Берём два
// последних сегмента и снимаем .git — остальное (хост, порт, пользователь) для адреса
// репозитория не нужно.
function parseRemoteUrl(url) {
    return /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)?.slice(1, 3).join('/') ?? url;
}

function assertFullName(value, source) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(value)) {
        throw new Error(
            `адрес репозитория из ${source} не читается как owner/name: "${value}"; задай RALPH_REPO=owner/name`,
        );
    }
    return value;
}

// Закрытая карточка — это Issue в CLOSED и PR в CLOSED/MERGED. Списки состояний
// ПОЛНЫЕ, а не только «закрытые»: незнакомое состояние (переименованный enum, новый
// регистр) не имеет права молча трактоваться как «не закрыт» — так синк тихо перестал
// бы замечать часть доски, ровно тот отказ, против которого он написан. Поэтому ниже
// на неизвестном state — throw, а не false.
const KNOWN_STATES = {
    Issue: { open: ['OPEN'], closed: ['CLOSED'] },
    PullRequest: { open: ['OPEN'], closed: ['CLOSED', 'MERGED'] },
};

// Типы контента без состояния вовсе: у черновика доски нечего синкать, это легальный
// пропуск, а не сомнительные данные.
const STATELESS_TYPES = ['DraftIssue'];

const BOARD_QUERY = `
query($owner: String!, $number: Int!, $cursor: String) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      field(name: "${STATUS_FIELD}") {
        ... on ProjectV2SingleSelectField { id options { id name } }
      }
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isArchived
          content {
            __typename
            ... on Issue { id number state }
            ... on PullRequest { id number state }
          }
          fieldValues(first: 100) {
            pageInfo { hasNextPage }
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                optionId
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
        }
      }
    }
  }
}`;

const UPDATE_MUTATION = `
mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(
    input: {projectId: $project, itemId: $item, fieldId: $field, value: {singleSelectOptionId: $option}}
  ) { projectV2Item { id } }
}`;

const ADD_ITEM_MUTATION = `
mutation($project: ID!, $contentId: ID!) {
  addProjectV2ItemById(
    input: {projectId: $project, contentId: $contentId}
  ) { item { id } }
}`;

// gh с ненулевым кодом — это сбой чтения, а не «данных нет»: spawnSync (не execSync,
// тот бросает Error без stderr в сообщении и чинить-сессия получает стектрейс вместо
// внятной строки — те же грабли чинили в security-audit.mjs). maxBuffer 16 МБ: дефолт
// 1 МБ, при переполнении child убивается и JSON.parse падает на обрезанном выводе.
export function runGh(args, spawnFn = spawnSync) {
    const result = spawnFn('gh', args, {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000, // повисший gh не должен подвешивать прогон фазы
    });
    if (result.status !== 0 || !result.stdout) {
        // || , а не ??: пустой stderr не nullish, и сообщение обрезалось бы до «: »
        const why = result.error?.message || result.stderr?.trim() || `код ${result.status}`;
        throw new Error(`gh ${args[0]} ${args[1] ?? ''} не вернул вывод: ${why}`);
    }
    return JSON.parse(result.stdout);
}

// Пагинация обязательна, а не «пока хватает»: без неё карточки за сотой молча остаются
// несинхронизированными — ровно тот молчаливый отказ, ради которого скрипт и пишется
// (на доске уже 150+ карточек). Ограничение сверху — страховка от бесконечного цикла
// на битом pageInfo, а не бизнес-лимит.
export function fetchBoard(ghFn = runGh, { owner, number } = {}) {
    const items = [];
    let cursor = null;
    let meta = null;
    for (let page = 1; page <= 50; page++) {
        // -f — строковый параметр, -F — типизированный (Int/Bool/null/@file). Перепутать
        // легко, а мок в тестах разницы не видит: строковый id, отданный через -F, gh
        // отвергает («Variable $option of type String! was provided invalid value») —
        // поймано живым прогоном, не тестом. Поэтому String! → -f, Int! → -F.
        const args = [
            'api',
            'graphql',
            '-f',
            `query=${BOARD_QUERY}`,
            '-f',
            `owner=${owner}`,
            '-F',
            `number=${number}`,
        ];
        if (cursor) args.push('-f', `cursor=${cursor}`);
        const project = ghFn(args)?.data?.organization?.projectV2;
        if (!project) {
            throw new Error(
                `доска ${owner}/projects/${number} не прочитана (ответ без data.organization.projectV2)`,
            );
        }
        meta ??= { projectId: project.id, field: project.field };
        const conn = project.items;
        if (!conn || !Array.isArray(conn.nodes)) {
            throw new Error('ответ без items.nodes — формат Projects API изменился');
        }
        items.push(...conn.nodes);
        if (!conn.pageInfo?.hasNextPage) return { ...meta, items };
        cursor = conn.pageInfo.endCursor;
        if (!cursor) throw new Error('hasNextPage=true без endCursor — пагинация ненадёжна');
    }
    throw new Error('пагинация доски не сошлась за 50 страниц — что-то не так с ответом API');
}

// Отсутствие поля Status или опции Done — не повод «пропустить синк»: это значит, что
// доску перенастроили, и все дальнейшие выводы скрипта недостоверны. Fail-closed.
export function resolveDone(field) {
    if (!field?.id) {
        throw new Error(`на доске нет single-select поля "${STATUS_FIELD}" — синк невозможен`);
    }
    const option = (field.options ?? []).find((o) => o.name === DONE_OPTION);
    if (!option) {
        const known = (field.options ?? []).map((o) => o.name).join(', ') || 'ни одной';
        throw new Error(
            `у поля "${STATUS_FIELD}" нет опции "${DONE_OPTION}" (есть: ${known}) — синк невозможен`,
        );
    }
    return { fieldId: field.id, doneOptionId: option.id };
}

export function isClosed(content) {
    const type = content?.__typename;
    if (!type || STATELESS_TYPES.includes(type)) return false;
    const states = KNOWN_STATES[type];
    if (!states) {
        throw new Error(
            `незнакомый тип карточки "${type}" — синк не берётся судить, закрыта ли она`,
        );
    }
    if (states.closed.includes(content.state)) return true;
    if (states.open.includes(content.state)) return false;
    throw new Error(
        `${type} #${content.number ?? '?'} в незнакомом состоянии "${content.state}" — ` +
            `enum GitHub изменился, сверка ненадёжна`,
    );
}

// Усечение списка значений полей обязано быть слышным: если Status не попал в выборку,
// «статуса нет» неотличимо от «статус Done», и карточка правилась бы каждый прогон —
// заявленная идемпотентность ломалась бы молча.
export function currentStatusOptionId(item) {
    if (item?.fieldValues?.pageInfo?.hasNextPage) {
        throw new Error(
            `у карточки #${item.content?.number ?? '?'} значений полей больше, чем запрошено — ` +
                `Status мог не попасть в выборку, сверка ненадёжна`,
        );
    }
    const values = item?.fieldValues?.nodes ?? [];
    return values.find((v) => v?.field?.name === STATUS_FIELD)?.optionId ?? null;
}

// Карточка попадает в правку, только если issue закрыт И статус ещё не Done. Второе
// условие — и есть идемпотентность: повторный прогон не делает ни одной мутации.
// Открытые issues не трогаются вовсе, каким бы ни был их статус: двигать Todo →
// Done по открытому issue — не синк, а порча доски.
// Архивные карточки исключаются намеренно: архив — это человеческое «убрать с доски»,
// а мутацию по архивной карточке API отвергает. Одна такая (а auto-archive — частая
// настройка доски) делала бы синк вечно красным на одной и той же записи.
export function pickStale(items, doneOptionId) {
    return items.filter(
        (item) =>
            item?.id &&
            !item.isArchived &&
            isClosed(item.content) &&
            currentStatusOptionId(item) !== doneOptionId,
    );
}

export function markDone(item, { projectId, fieldId, doneOptionId }, ghFn = runGh) {
    ghFn([
        'api',
        'graphql',
        '-f',
        `query=${UPDATE_MUTATION}`,
        '-f',
        `project=${projectId}`,
        '-f',
        `item=${item.id}`,
        '-f',
        `field=${fieldId}`,
        '-f',
        `option=${doneOptionId}`,
    ]);
}

// #90: второй проход того же барьера — карточка, заведённая мимо доски, на неё не попадает
// сама. `gh issue create` (в том числе намерением `new-issue` раннера) доски не знает, а
// встроенная автоматизация Projects добавляет только созданное ИЗ доски: issue заводится,
// на доске его нет, и об этом никто не узнаёт — тот же молчаливый разъезд, что и #199.
//
// Берём ВСЕ открытые issues, а не выборку по метке (`backlog`): раннер создаёт карточки
// РОВНО с метками из намерения (createIssue в core/orchestrator.ts ничего не добавляет), а
// образец намерения в ralph.md идёт без `backlog`. Фильтр по метке молча исключил бы именно
// тот класс, ради которого проход и писался, — и проект-правило «новые issues обязательно
// на доске» держалось бы только на дисциплине автора намерения.
//
// --limit обязателен: дефолт `gh issue list` — 30 карточек, МОЛЧА. Упор в потолок — throw,
// а не усечение: «столько и есть» неотличимо от «дальше не посмотрели», а именно эта
// неотличимость и есть отказ, против которого написан весь файл.
export function fetchOpenIssues({ repo, limit = OPEN_ISSUES_LIMIT } = {}, ghFn = runGh) {
    const result = ghFn([
        'issue',
        'list',
        '--repo',
        repo,
        '--state',
        'open',
        '--limit',
        String(limit),
        '--json',
        'number,id',
    ]);
    if (!Array.isArray(result)) {
        throw new Error(
            'gh issue list вернул не список — формат вывода изменился, сверка ненадёжна',
        );
    }
    if (result.length >= limit) {
        throw new Error(
            `открытых issues не меньше потолка выборки (${limit}) — часть репозитория осталась бы ` +
                `непроверенной; подними OPEN_ISSUES_LIMIT`,
        );
    }
    return result;
}

// Добавляет issue на доску БЕЗУСЛОВНО: проверку «нет ли уже» делает вызывающий
// (addMissingIssues) — здесь, как и в markDone, ровно одна мутация без своей политики.
export function addIssueToBoard(issueId, { projectId }, ghFn = runGh) {
    ghFn([
        'api',
        'graphql',
        '-f',
        `query=${ADD_ITEM_MUTATION}`,
        '-f',
        `project=${projectId}`,
        '-f',
        `contentId=${issueId}`,
    ]);
}

// `board` — уже прочитанная доска (fetchBoard): один проход пагинации на оба прохода синка.
// Не передали — читает сама, чтобы функция оставалась вызываемой отдельно.
export function syncBoard({ ghFn = runGh, owner, number, board, logFn = console.log } = {}) {
    const { projectId, field, items } = board ?? fetchBoard(ghFn, { owner, number });
    const { fieldId, doneOptionId } = resolveDone(field);
    const stale = pickStale(items, doneOptionId);
    for (const item of stale) {
        markDone(item, { projectId, fieldId, doneOptionId }, ghFn);
        logFn(`   • #${item.content.number} → ${DONE_OPTION}`);
    }
    return { scanned: items.length, updated: stale.length };
}

// #90: добавить на доску открытые issues, которых на ней нет. Идемпотентен — issue уже на
// доске не порождает ни одной мутации (то же свойство, что у syncBoard, и проверяется тестом).
//
// Сверка по node-id контента, а НЕ по номеру: доска Projects штатно держит карточки
// нескольких репозиториев (fetchBoard их не фильтрует), а номера в разных репо пересекаются
// — чужой #90 «скрыл» бы свой, и карточка не добавилась бы молча. `id` из
// `gh issue list --json id` — тот же node-id, что отдаёт GraphQL `content.id`, поэтому
// сравнение однородно и фильтр по `__typename` не нужен.
//
// Архивные карточки СЧИТАЮТСЯ присутствующими на доске — противоположно pickStale, и это
// осознанно: там архив исключается, потому что мутацию по архивной карточке API отвергает
// (одна такая красила бы синк вечно); здесь архив — человеческое «убрать с доски», и
// затащить карточку обратно значило бы каждый прогон отменять решение человека.
export function addMissingIssues({
    ghFn = runGh,
    owner,
    number,
    board,
    repo,
    logFn = console.log,
} = {}) {
    const { projectId, items } = board ?? fetchBoard(ghFn, { owner, number });
    const onBoard = new Set(items.map((item) => item?.content?.id).filter(Boolean));

    const open = fetchOpenIssues({ repo }, ghFn);
    let added = 0;
    for (const issue of open) {
        if (onBoard.has(issue.id)) continue;
        addIssueToBoard(issue.id, { projectId }, ghFn);
        logFn(`   • #${issue.number} добавлена на доску`);
        added++;
    }

    return { checked: open.length, added };
}

// Оба прохода синка за один проход по доске + ИТОГОВАЯ строка возвращается, а не
// печатается: раннер кладёт в ralph.log ровно ПОСЛЕДНЮЮ строку вывода (syncProjectBoard,
// core/orchestrator.ts). Пока сводка одна и печатает её вызывающий последней, «переведено
// в Done» не может быть вытеснено из лога отчётом о добавленных карточках — а именно так
// и вышло бы с двумя сводками в прогон, где на доске было больше всего движения.
export function runSync({ ghFn = runGh, owner, number, repo, logFn = console.log } = {}) {
    // Доска читается ОДИН раз на оба прохода: пагинация 300+ карточек — четыре запроса
    // GraphQL, и повторный проход ради тех же данных был бы платой ни за что.
    const board = fetchBoard(ghFn, { owner, number });
    const { scanned, updated } = syncBoard({ ghFn, board, logFn });
    // Добавление — fail-closed, как и синк статусов: протухший токен или снятое право на
    // доску не имеют права выглядеть как «добавлять нечего». Ронять из-за этого смердженную
    // фазу не приходится — вызов раннера (syncProjectBoard) сам best-effort и переживает
    // ненулевой код скрипта.
    const { checked, added } = addMissingIssues({ ghFn, board, repo, logFn });
    // Сводка печатается ВСЕГДА, в том числе на нулях: «проверил, всё на месте» обязано быть
    // отличимо от «не проверял вовсе» — ради этой отличимости синк и заводился.
    return (
        `✅ project-sync: в ${DONE_OPTION} переведено — ${updated} (просмотрено ${scanned}), ` +
        `добавлено на доску — ${added} (открытых issues ${checked})`
    );
}

function main() {
    try {
        console.log(runSync({ ...resolveBoard(), repo: resolveRepo() }));
    } catch (e) {
        console.error(`⛔ project-sync: ${e.message}`);
        process.exit(1);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
