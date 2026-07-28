# Перенос раннера ralph в новый репозиторий — чек-лист

Цель фазы 4 (#204): перенос = скопировать `.claude/ralph/` + `scripts/` и заполнить **один
конфиг**, без правок кода ядра. Ниже — минимальный список того, что заполнить и завести.
Дорогая часть переноса — не код, а институты (доска, метки, дисциплина issues); см. раздел
«Честная цена переноса» в `.claude/ralph/CLAUDE.md`.

## 1. Заполнить `.claude/ralph/ralph.config.json`

Всё проектное теперь в конфиге (профили `common` + `profiles.<name>`):

| Ключ (в `common`)        | Что задать                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `installCmd`             | Команда установки зависимостей. Дефолт `npm ci`; для не-npm стека — своё (`pnpm i --frozen-lockfile`…). |
| `board.owner`            | Организация/владелец доски GitHub Projects (env `RALPH_BOARD_OWNER` важнее).                            |
| `board.number`           | Номер доски Projects (env `RALPH_BOARD_NUMBER` важнее). Целое > 0.                                      |
| `gate.checks`            | Базовый состав чеков гейта — массив пар `[имя, команда]`. **Порядок = fail-fast, дешёвый → дорогой.**   |
| `gate.prodChecks`        | Толстые чеки прод-профиля (добавляются к базе). Тоже пары `[имя, команда]`.                             |
| `gate.prodDropChecks`    | Имена базовых чеков, снимаемых в prod (дедуп, напр. `test` в пользу `coverage`). Можно `[]`.            |
| `runnerWorktreeDirname`  | Имя соседнего дерева раннера. Необязательно: дефолт — `<имя-репо>-ralph`.                               |
| `runnerWorktreePath`     | Полный путь дерева раннера (важнее dirname и env `RALPH_WORKTREE_PATH`). Обычно не нужен.               |
| `deployCheck.healthUrl`  | URL health-чека прода (только prod-профиль). Без него пост-мердж healthcheck fail-closed пропускается.  |
| `phases`                 | Список фаз `{ milestone, branch }` в порядке исполнения.                                                |
| `authorAllowlist`        | gh-логины доверенных авторов issues (репо публичный + bypassPermissions → защита от инъекций).          |
| `modelRouting`, `review` | Роутинг кодер-модели по `complexity:*`; модель ревью и эскалация по зонам риска.                        |

Все обязательные значения — **fail-closed**: пустой `gate.checks`, отсутствующий
`board.owner`/`number`, кривой `healthUrl` останавливают раннер с внятным сообщением, а не
подставляют «как у нас».

## 2. Скрипты чеков под свой стек

`gate.checks`/`prodChecks` ссылаются на npm-скрипты (`scripts/*.mjs`: security-audit,
test-ratchet, project-sync и т.д.). Перенеси нужные и поправь `package.json`-скрипты, либо
задай в конфиге прямые команды своего стека. Сохрани fail-fast порядок.

## 3. Метки в репозитории (иначе роутинг слеп)

- `complexity:{low|medium|high|expert}` — по ним раннер выбирает кодер-модель
  (`modelRouting.labels`). Без метки карточку роутинг не видит.
- `area:*` — зона изменений (для навигации/фильтров).
- `blocked` — «упёрся в ручной гейт, разбирай по кругу» (ставит ревью/раннер).
- `hold` — «стоп, решает человек» (ставит/снимает **только человек**).
- `backlog` — задача вне текущей фазы.

## 4. Доска GitHub Projects

- Single-select поле **`Status`** с опцией **`Done`** — `project-sync.mjs` переводит
  закрытые карточки в Done. Нет поля/опции → синк fail-closed.
- Завести карточки фаз ДО старта; конвенция «фаза = milestone, ветка фазы = `feature/…`».

## 5. Секреты в env (`/root/ralph.env` или окружение прогона)

- `GH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` — обязательны.
- `RALPH_TG_BOT_TOKEN`, `RALPH_TG_CHAT_ID` — обязательны для профиля `prod` (fail-closed).
- Опционально: `RALPH_BOARD_OWNER`/`RALPH_BOARD_NUMBER` (перебивают `common.board`),
  `RALPH_WORKTREE_PATH`, `RALPH_EXPECTED_EGRESS`/`SS_SERVER` (туннель в РФ).

## 6. Специфика окружения

- `tunnelCheck` — health-check Shadowsocks-туннеля, нужен только для VDS-в-РФ; в другом
  окружении `enabled: false`.
- `provision/` — специфика конкретного VDS, не переносится дословно.

## Что переносится как есть (правок кода не требует)

Вся хореография `ralph.js`/`orchestrator.ts` (профили, worktree-изоляция, цикл сдачи,
детерминированный гейт, self-heal, breaker'ы, API-лимит), `deadman.js`,
`telegram-notifier.js`, предохранитель побочек #138, `baseline-policy.mjs`. Проектная
половина промпт-контракта — `ralph.project.md` (общий контракт — `ralph.md`).
