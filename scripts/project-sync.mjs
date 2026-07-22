#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
const DEFAULT_OWNER = 'AtlantaTeam';
const DEFAULT_NUMBER = 1;
const STATUS_FIELD = 'Status';
const DONE_OPTION = 'Done';

// Закрытая карточка — это Issue в CLOSED и PR в CLOSED/MERGED. Список исчерпывающий
// намеренно: незнакомое состояние (новый тип content, переименованный enum) не должно
// молча трактоваться как «не закрыт» — иначе синк тихо перестанет замечать часть доски.
const CLOSED_STATES = { Issue: ['CLOSED'], PullRequest: ['CLOSED', 'MERGED'] };

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
          content {
            __typename
            ... on Issue { number state }
            ... on PullRequest { number state }
          }
          fieldValues(first: 20) {
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

// gh с ненулевым кодом — это сбой чтения, а не «данных нет»: spawnSync (не execSync,
// тот бросает Error без stderr в сообщении и чинить-сессия получает стектрейс вместо
// внятной строки — те же грабли чинили в security-audit.mjs). maxBuffer 16 МБ: дефолт
// 1 МБ, при переполнении child убивается и JSON.parse падает на обрезанном выводе.
export function runGh(args, spawnFn = spawnSync) {
    const result = spawnFn('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0 || !result.stdout) {
        const why = result.error?.message ?? result.stderr?.trim() ?? `код ${result.status}`;
        throw new Error(`gh ${args[0]} ${args[1] ?? ''} не вернул вывод: ${why}`);
    }
    return JSON.parse(result.stdout);
}

// Пагинация обязательна, а не «пока хватает»: без неё карточки за сотой молча остаются
// несинхронизированными — ровно тот молчаливый отказ, ради которого скрипт и пишется
// (на доске уже 150+ карточек). Ограничение сверху — страховка от бесконечного цикла
// на битом pageInfo, а не бизнес-лимит.
export function fetchBoard(ghFn = runGh, { owner = DEFAULT_OWNER, number = DEFAULT_NUMBER } = {}) {
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
    const states = CLOSED_STATES[content?.__typename];
    if (!states) return false;
    return states.includes(content.state);
}

export function currentStatusOptionId(item) {
    const values = item?.fieldValues?.nodes ?? [];
    return values.find((v) => v?.field?.name === STATUS_FIELD)?.optionId ?? null;
}

// Карточка попадает в правку, только если issue закрыт И статус ещё не Done. Второе
// условие — и есть идемпотентность: повторный прогон не делает ни одной мутации.
// Открытые issues не трогаются вовсе, каким бы ни был их статус: двигать Todo →
// Done по открытому issue — не синк, а порча доски.
export function pickStale(items, doneOptionId) {
    return items.filter(
        (item) =>
            item?.id && isClosed(item.content) && currentStatusOptionId(item) !== doneOptionId,
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

export function syncBoard({ ghFn = runGh, owner, number, logFn = console.log } = {}) {
    const { projectId, field, items } = fetchBoard(ghFn, { owner, number });
    const { fieldId, doneOptionId } = resolveDone(field);
    const stale = pickStale(items, doneOptionId);
    for (const item of stale) {
        markDone(item, { projectId, fieldId, doneOptionId }, ghFn);
        logFn(`   • #${item.content.number} → ${DONE_OPTION}`);
    }
    return { scanned: items.length, updated: stale.length };
}

function main() {
    try {
        const { scanned, updated } = syncBoard();
        console.log(
            updated
                ? `✅ project-sync: переведено в ${DONE_OPTION} закрытых карточек — ${updated} (просмотрено ${scanned})`
                : `✅ project-sync: доска в порядке, правок не потребовалось (просмотрено ${scanned})`,
        );
    } catch (e) {
        console.error(`⛔ project-sync: ${e.message}`);
        process.exit(1);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
