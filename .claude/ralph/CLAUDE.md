# Ralph loop — мини-фреймворк автономной разработки

Контекст для агента, который **правит код раннера**. Смежные документы не дублируем:
как запускать и на какие грабли наступали — `RUNBOOK.md`; правила для кодер-сессии
внутри петли — `ralph.md`. Здесь — архитектура, инварианты и границы переносимости.

## Что это

Ralph loop — внешний цикл автономной разработки поверх GitHub Issues: Node-скрипт
`ralph.js` крутит while-loop и на каждом шаге запускает **отдельную чистую сессию**
`claude -p` (1 issue = 1 сессия). Когда issues milestone фазы кончаются, раннер сам
проводит полный цикл сдачи: сессия «создай PR» → сессия ревью (отдельная модель) →
сессия правок по ревью → **детерминированный гейт** (раннер сам гоняет build/lint/
typecheck/тесты на точном sha PR-головы) → squash-merge → следующая фаза. Внешний
цикл — сознательный отказ от Stop-hook-варианта (claude внутри хука предыдущего claude):
состояние восстанавливаемо, каждый шаг переживает падение и рестарт.

Процессы: человек запускает `node .claude/ralph/ralph.js --profile <name>` (tmux, см.
RUNBOOK). Раннер сам поднимает detached-`monitor.js` (панель + deadman-детект тишины по
свежести `ralph.log`; сироту прошлого прогона подхватывает `adoptMonitor`). `deadman.js` —
чистые правила порогов тишины, их импортирует монитор. `telegram-notifier.js` — доставка
пуш-событий человеку (только профиль `prod`). Гейт дополнительно зовёт
`scripts/security-audit.mjs` (+ `baseline-policy.mjs`) и `scripts/project-sync.mjs`.

## Архитектурные инварианты — что сломаешь, если сделаешь наивно

1. **Fail-closed везде, где решение о режиме или мердже.** Кривой конфиг/профиль,
   пустой `authorAllowlist`, отсутствующие TG-секреты в prod, разъехавшийся state,
   несмердженная предыдущая фаза (C4), упавшее ревью или шаг сдачи (H2) — это `fail()`
   и стоп, а не тихий дефолт. «Молча свалился в playground, думая что он prod» — худший
   исход. Fail-open допускается только для косметики (синк доски, закрытие milestone,
   монитор) — и всегда с логом.
2. **Все побочки — через DI с боевыми дефолтами + предохранитель #138.** Каждая функция
   берёт коллабораторов параметрами (`shFn`, `saveStateFn`, `installFn`, `spawnFn`, …).
   В тестах (`vitest` проект `ralph` ставит `RALPH_NO_SIDE_EFFECTS=1`) боевой дефолт
   зовёт `guardSideEffect`: бросает исключение **и** пишет попытку в журнал
   `sideEffectAttempts`, который общий `afterEach` (`test-setup.js`) сверяет с пустотой —
   потому что половина вызовов стоит под try/catch и один throw тест бы не покраснил.
   Новая побочка без guard'а = тест однажды молча сходит в настоящий git живого прогона
   (так и было: `feature/m1` из фикстур в боевом `ralph.log`).
3. **Раннер живёт в выделенном worktree** (`../pixel-tanks-ralph`, сосед репозитория) и
   **никогда не трогает дерево и ветки человека**. Вся git-хореография — только
   `--detach` (PR-голова, `origin/main`); локальный `main` не занимать и не обновлять —
   git и не даст один ref двум worktree. Путь worktree внутри репозитория — ошибка
   (fail-closed в `ensureRunnerWorktree`).
4. **Гейт детерминирован и не верит агенту на слово.** Мердж только если: нет открытых
   issues milestone **включая blocked и чужие** (C2 — «очередь пуста» ≠ «фаза готова»),
   PR без label `hold` **и** без `blocked` (`hold` проверяется первым — #222, человеческий
   стоп-кран сильнее автоматического разбора; в коде нет функции, снимающей `hold`, только
   `removeBlockedLabel` для `blocked`), локальный ref ветки == голова PR (H3), все чеки
   зелёные на detached checkout **точного sha** PR-головы, и
   `gh pr merge --match-head-commit <sha>` закрывает TOCTOU-окно между чеками и мерджем.
   Порядок прод-чеков — fail-fast от дешёвого к дорогому (security → coverage → e2e): не
   переставлять.
5. **Барьеры важнее промптов.** Бриф надёжности (`docs/ralph-reliability/brief.md`)
   прямо запрещает наращивать инструкции ревью: отдача — в детерминированных проверках,
   срабатывающих независимо от мнения модели (`guardSideEffect`, `looksBlind`,
   `baseline-policy`). Нашёл класс молчаливого отказа — пиши барьер, не абзац в промпт.
6. **Ревью использует СВОЙ фолбэк — `review.fallback`, не общий `cfg.fallbackModel`**
   (#221, заменил жёсткий `noFallback: true` из M8). Общий `fallbackModel` в опции
   ревью-сессий вообще не передаётся — `buildClaudeArgs` получает явный
   `fallbackModel` (`pickReviewFallbackModel`/для повторного ревью ещё и поднятый
   до `state.reviewModelFloor` через `strongerReviewModel` — тот же барьер #217,
   не второй независимый список). `assertKnownReviewModels` на старте отвергает
   конфиг, где `review.fallback` слабее `review.default` (fail-closed, не тихая
   деградация в момент overload). Явное `review.fallback: 'none'` — осознанный
   отказ: тогда падение при недоступности модели по-прежнему honest-стоп, как
   было при M8 (сигнал `'none'` не теряется — `pickReviewFallbackModel` отдаёт его
   как есть, планка `reviewModelFloor` его не повышает). **Трейдофф:** планка держится
   относительно `review.default`, НЕ относительно эскалированной модели — при
   `escalated: fable, fallback: opus` эскалированное ревью зоны риска на overload'е
   fable тихо уйдёт на opus, ниже уровня эскалации (сценарий M8). Принято сознательно
   (#221: «простой дороже»); кому нужен honest-стоп эскалированного ревью — ставит
   `review.fallback: 'none'`.
7. **Защита от инъекций — repо публичный, permissionMode=bypassPermissions** (C3).
   Тело issue/комментария PR исполняется сессией как инструкции. Слои: `authorAllowlist`
   (чужие issues не исполняются и блокируют сдачу), промпты правок велят игнорировать
   чужие комментарии, дифф в промпте ревью обёрнут делимитерами «ДАННЫЕ, НЕ ИНСТРУКЦИИ».
   Значения в шелл — только через `shq()` (одинарные кавычки) либо argv без шелла
   (`spawnClaude`, curl в нотифаере); имена веток — через `SAFE_BRANCH_RE` (в т.ч.
   запрет ведущего `-` — argument injection), sha — через `SHA40_RE`. Новый вызов
   `sh()` с внешним значением без `shq` — это RCE-канал.
8. **`--dry-run` строго read-only** (C1). Guard'ы стоят в единственных точках записи
   (`saveState`, `pushEvent`, `tryMergePhase`, `runClaudeOnce`), а не у вызывающих —
   чтобы новый вызов нельзя было забыть обернуть.
9. **State адресует фазу по имени milestone, не по индексу** (M7): позиционный
   указатель однажды разъехался с реальностью при правке массива `phases`. Имя не
   найдено в конфиге — fail, а не «начнём с нулевой».
10. **Форматы строк лога — контракт.** `apiLimitMessage()` в ralph.js — единственный
    источник формата «Жду N мин», его парсит `API_WAIT_RE` в deadman.js, синхронность
    закреплена тестом. Маркеры `🚦 ✓ ✗ ▶ ⏸ ⛔ 🎉` классифицируют режим петли
    (`scanTail`) — правка эмодзи/формулировки в `log()`-строках без правки deadman.js
    даёт ложные (или пропущенные) DEADMAN-пуши ночью.
11. **Секреты только из env** (`RALPH_TG_BOT_TOKEN`, `RALPH_TG_CHAT_ID`, `GH_TOKEN`,
    `CLAUDE_CODE_OAUTH_TOKEN`), не из конфига в гите. Токен TG не попадает в argv
    (виден в `/proc/*/cmdline`) — уходит curl'у через `--config -` со stdin; в логах
    редактируется.
12. **Монитор строго read-only** и не пишет в `ralph.log`: свежесть этого файла —
    признак жизни раннера, пуш монитора в него «оживил» бы мёртвую петлю для самого
    детекта. Deadman не останавливает цикл — только пуш (alert-first по PRD).

## Карта модулей

| Файл                                  | Ответственность                                                                                                                                                                                                                         | Что нельзя ломать                                                                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ralph.js`                            | **ТОНКИЙ entry** (#365): проверка Node ≥24 до первого `require('*.ts')`, парсинг + allowlist CLI-флагов режима, вызов `createOrchestrator`, ре-экспорт API (`module.exports = runtime`), запуск `main()`. Логики петли здесь БОЛЬШЕ НЕТ | fail-closed до загрузки TS-ядра; `main()` и allowlist флагов — под `require.main === module` (иначе тест-раннер упал бы на своих флагах); прежняя API-поверхность для тестов/монитора |
| `orchestrator.ts`                     | **Ядро петли** (#365): фабрика `createOrchestrator` — цикл итераций, цикл сдачи, оркестрация гейта, self-heal, breaker'ы, API-лимит, спавн монитора, `main`; стыкует все модули ниже + додаёт оставшееся из `ralph.js`                  | инварианты C1–C4/H1–H4/M1–M8 из докблоков; DI всех коллабораторов; `config`/`DRY` захватываются один раз; контракт `REQUIRED_API` (`orchestrator.test.js`)                            |
| `exec.ts`                             | Примитивы исполнения и лога (#365): `log`/`fail`/`setLogTarget`, `sh` (чтения #133) / `shArgv` (мутации #193/#252), `ghJson` (ретраи+backoff M3), `loadJson`                                                                            | `sh`/`shArgv` под общим `guardSideEffect` #138; `log` знает текущий `logTarget`; `ghJson` — только ЧТЕНИЕ                                                                             |
| `config-profile.ts`                   | Профили конфига (#71→#365): `deepMerge` (`common` → профиль), `parseProfileFlag`, `resolveProfile`, валидация `haltBeforeDeploy`                                                                                                        | fail-closed на любом изъяне схемы; запрещённые ключи `__proto__`/… (скан всей глубины, ярлык пути по блоку); профиль не дублирует `common`                                            |
| `gate.ts`                             | Детерминированный гейт (#362): состав чеков, `checksGreen` на точном sha PR-головы, `tryMergePhase` (`hold` ПЕРВЫМ), переход метки blocked (`setBlockedLabel` → `remove`/`addBlockedLabel`)                                             | порядок прод-чеков fail-fast (security→coverage→e2e); `hold` сильнее `blocked` и снимается ТОЛЬКО человеком; `--match-head-commit` (TOCTOU)                                           |
| `review.ts`                           | Ревью (#363): роутинг модели по зонам риска (`escalateOnPaths`), СВОЙ фолбэк `review.fallback` (#221), планка `reviewModelFloor` (#217), журнал находок (#169), `assertKnownReviewModels`                                               | ревью-фолбэк — `review.fallback`, НЕ `cfg.fallbackModel`; планка не опускает модель ниже поставившей блок; барьеры важнее промптов (инвариант №5)                                     |
| `deploy-check.ts`                     | Пост-мердж деплой-проверка (#364): `mergedShaOf`, `waitForDeployRun` (#163), `checkProdHealth` (#164), `classifyDeployOutcome` (#165)                                                                                                   | fail-closed классификация (GREEN только при зелёном workflow И здоровом проде); только ЧТЕНИЕ `gh` (#166); формат `deployWaitMessage` ↔ `DEPLOY_WAIT_RE`                              |
| `state-lock.ts`                       | Три файла раннера (#359): `ralph.state.json` (state фазы, адресуется по имени milestone — M7), `ralph.lock` (#176–178, pid-проверка), `.deps-lock.sha` (маркер `npm ci`)                                                                | фаза по ИМЕНИ milestone, не индексу (M7); лок с проверкой живости pid; `guardSideEffect` на записи                                                                                    |
| `worktree.ts`                         | Worktree-изоляция раннера (#360): resolve/parse/ensure/refresh выделенного дерева соседом репозитория                                                                                                                                   | только `--detach` (PR-голова / `origin/main`); путь ВНУТРИ репо — fail-closed; локальный `main` не занимать (инвариант №3)                                                            |
| `tunnel-check.ts`                     | Health-check Shadowsocks-туннеля (#361), специфика прода в РФ: сверка egress, рестарт `ss-local`/`privoxy`, fail-closed стоп + пуш                                                                                                      | только профиль `prod`; красный канал после рестарта = стоп всего loop; `guardSideEffect` на `curl`/`systemctl`                                                                        |
| `api-limit.ts`                        | Детекция и расчёт паузы API-лимита (#361): `API_LIMIT_RE`, парсинг времени сброса, длительность паузы, текст события                                                                                                                    | чистые функции без побочек (как `ralph-util.ts`); `apiLimitMaxWaits/GraceMin/FallbackWaitMin` — через `positiveIntOrDefault`; сам цикл ожидания живёт в `orchestrator.ts`             |
| `monitor.js`                          | Панель прогресса + deadman-пуш с дедупом по mtime лога                                                                                                                                                                                  | Read-only; одно чтение лога на тик; `logFn: console.log` у пуша (не `log()` раннера)                                                                                                  |
| `deadman.js`                          | Чистые правила: классификация хвоста лога → порог тишины по режиму                                                                                                                                                                      | Без побочек вовсе; режим `stopped` = порог Infinity; сверка с `apiLimitMessage`                                                                                                       |
| `telegram-notifier.js`                | Отправка в TG, fail-open, anti-RCE argv, токен вне argv                                                                                                                                                                                 | Самостоятельный модуль (не require ralph.js — цикл); предохранитель и журнал — общие из `side-effect-guard.ts`                                                                        |
| `ralph-util.ts`                       | Общие чистые утилиты без побочек (#232): `shq` (POSIX-квотирование), `positiveIntOrDefault`, `sleep`                                                                                                                                    | TS без билд-шага (type stripping Node 24, erasable-only); без записи на диск/сеть → guardSideEffect не нужен; `sleep` сам отсекает NaN/±∞/отрицательное                               |
| `side-effect-guard.ts`                | Общий предохранитель #138 (`NO_SIDE_EFFECTS`/`sideEffectAttempts`/`guardSideEffect`) на все три потребителя                                                                                                                             | TS без билд-шага; один журнал на ralph.js/telegram-notifier.js/security-audit.mjs (кеш модуля Node отдаёт тот же массив); `hint` — параметр, у потребителей разные DI                 |
| `ralph.md`                            | **Общий** промпт-контракт кодер-сессии (ветки, TDD, blocked, завершение) — переносимый                                                                                                                                                  | Читается сессией из worktree — правки действуют только после попадания в `origin/main`                                                                                                |
| `ralph.project.md`                    | **Проектная** половина контракта (#204): UI-контроль, стек, тема — заменяется при переносе                                                                                                                                              | Читается сессией вместе с `ralph.md`; общий контракт при переносе берётся как есть, этот файл — свой                                                                                  |
| `ralph.config.json`                   | Конфиг: `common` + дельты `profiles`, фазы, роутинг моделей, ревью                                                                                                                                                                      | Профиль не дублирует common; запрещённые ключи `__proto__`/…; во время прогона не трогать                                                                                             |
| `scripts/security-audit.mjs`          | Детерминированный security-чек гейта: сверка advisory-id с baseline, `--omit=dev`                                                                                                                                                       | `looksBlind` (baseline непуст, находок ноль = ослеп → красный); политика ДО сверки                                                                                                    |
| `scripts/baseline-policy.mjs`         | Права на изменение baseline (#207): апстрим-дрейф — авто + пуш; «сам притащил» (PR трогает deps) — красный; TTL записей 14/42 дня                                                                                                       | Опирается только на git-факты, которые агент не может подделать; рост severity = новая запись                                                                                         |
| `scripts/project-sync.mjs`            | Идемпотентный синк доски Projects: закрытые карточки → Status=Done                                                                                                                                                                      | Fail-closed на незнакомом state; сам скрипт красный, обёртка в раннере — best-effort                                                                                                  |
| `scripts/review-findings.mjs`         | Счёт находок ревью петли по severity (#168): парсинг меток `🔴/🟠/🟡/⚪` из комментариев PR (issues/pulls/reviews) через `gh api`                                                                                                       | Метка обязана быть ПЕРВЫМ символом комментария — контракт ревью-промпта, не эвристика                                                                                                 |
| `scripts/review-findings-journal.mjs` | Журнал находок по фазам (#169): JSONL `.claude/ralph/review-findings.jsonl`, гитигнорен как ralph.log/ralph.state.json — раннер нигде не коммитит в main напрямую                                                                       | `recordReviewFindings` в ralph.js зовёт его fail-open (как closeMilestoneByTitle/syncProjectBoard) сразу на `gate === 'merged'`; source `review-loop`/`found-after` (#170)            |
| `test-setup.js` / `test-helpers.js`   | Общий afterEach предохранителя #138 на весь vitest-проект `ralph`                                                                                                                                                                       | Сверяет единый журнал `side-effect-guard.ts` (один на все три модуля); не переносить обратно в один тест-файл                                                                         |

## Слои конфигурации

Уже настраивается через `ralph.config.json` (профили `common` + `profiles.<name>`,
глубокий мердж объектов, массивы заменяются целиком):

- `phases` (milestone + branch), `prompt` (шаблон с `{milestone}`/`{branch}`);
- `modelRouting.labels` — роутинг кодер-модели по метке `complexity:*`;
- `review.*` — модель ревью, эскалация по зонам риска диффа (`escalateOnPaths`),
  бюджет ходов, лимит диффа;
- breaker'ы: `maxIterations`, `maxTurns`, `maxNoProgress`, `gateHealAttempts`,
  `blockedHealAttempts`; API-лимит: `apiLimitMaxWaits/GraceMin/FallbackWaitMin`;
- `deadman.*` — пороги тишины; `tunnelCheck.*`; `authorAllowlist`; `permissionMode`;
- `runnerWorktreePath` (конфиг важнее env `RALPH_WORKTREE_PATH`);
- `gate.checks`/`prodChecks`/`prodDropChecks` (#204) — состав чеков гейта парами
  `[имя, команда]`, база + толстые прод-чеки + имена снимаемых в prod (дедуп
  test↔coverage). Fail-fast порядок — на авторе конфига; форму валидирует
  `resolveGateChecks` (gate.ts, fail-closed на пустом/битом списке);
- `installCmd` (#204) — команда установки зависимостей (дефолт `npm ci`);
- `board.owner`/`board.number` (#204) — доска Projects для `project-sync.mjs`
  (env `RALPH_BOARD_OWNER`/`RALPH_BOARD_NUMBER` важнее; `resolveBoard` fail-closed);
- `runnerWorktreeDirname` (#204) — имя соседнего дерева раннера (дефолт `<имя-репо>-ralph`);
- `deployCheck.healthUrl` — URL пост-мердж healthcheck (prod); без него проверка
  fail-closed пропускается, проектного фолбэка в коде больше нет (#204);
- `haltBeforeDeploy` (bool, #249) — только `profileName: 'prod'`. Дефолт (не задан
  либо `true`) = поведение #87: стоп после каждой смердженной фазы, следующая
  начинается новым запуском loop. `false` — непрерывный prod: на ЗЕЛЁНОМ пост-мердж
  деплое (фаза 5, `#163`) `continue` вместо `break`, следующая фаза уже поднята
  `advancePhase`. Красный/недосмотренный деплой стопорит трек ВСЕГДА — флаг не
  читается, пока `block` не `null` (fail-closed: непрерывный режим не катит фазу
  N+1 поверх непроверенного релиза N). Валидируется на старте
  (`assertValidHaltBeforeDeploy`): не-boolean или флаг вне профиля `prod` = fail,
  а не тихий halt (инвариант №1). **Следствие непрерывного режима:** конфиг (включая
  массив `phases`) и код раннера читаются один раз при старте процесса. Смердженные
  во время прогона правки `ralph.config.json`/`ralph.js` процесс НЕ увидит — воркфлоу
  «дозаказать фазы мерджем конфига в main» (d5c8962, 8649a05) в непрерывном прогоне не
  работает: раннер честно скажет «Все фазы завершены» по устаревшему списку, а фаза,
  правившая сам `ralph.js`, доедет до исполнения только после рестарта. Не баг
  (halt-дефолт и рестарт всё чинят), но при первом включении `false` держи в голове.

Проектная специфика вынесена в конфиг (#204, фаза 4 «Конфиг-граница»): состав гейта,
команда установки, доска, имя worktree, health-URL — всё в `ralph.config.json` (см. выше),
код ядра проектных строк не содержит (`grep pixel-tanks|AtlantaTeam|game-next` по
`ralph.js`/`monitor.js`/`telegram-notifier.js`/`project-sync.mjs` пуст вне комментариев).
Промпт-контракт разделён: общий — `ralph.md`, проектный (UI-скилл, тема, стек) —
`ralph.project.md`. Чек-лист переноса — `docs/ralph-mini-framework/porting-checklist.md`.
(Поиск PR фаз в `monitor.js` тоже не прибит к проекту — `openPhasePRs` берёт ветку из
конфига, #214.)

Остаётся в коде осознанно (правила ядра, не проектная специфика): fail-fast порядок чеков
как контракт (порядок задаёт автор конфига), суффикс `-ralph` имени worktree, дефолт
`npm ci` установки.

## Переносимость в другой проект

Ориентир — issue #204 (закрыт фазой 4): цель «скопировать `.claude/ralph/` + `scripts/` и
заполнить один конфиг» механически достигнута. Пошаговый чек-лист заполнения —
`docs/ralph-mini-framework/porting-checklist.md`.

**Переносится как есть:** вся хореография `ralph.js`/`orchestrator.ts` (профили,
worktree-изоляция, цикл сдачи, гейт, self-heal, breaker'ы, API-лимит), `deadman.js`,
`telegram-notifier.js`, предохранитель #138, `baseline-policy.mjs` (правила не знают
про проект).

**Заполнить в конфиге (`ralph.config.json`), НЕ в коде (#204):** состав гейта
(`gate.checks`/`prodChecks`/`prodDropChecks`, сохранив fail-fast порядок); команда
установки (`installCmd`, для не-npm стека — своя); доска (`board.owner`/`number` или env
`RALPH_BOARD_*`); имя worktree (`runnerWorktreeDirname`, иначе дефолт `<имя-репо>-ralph`);
health-URL (`deployCheck.healthUrl`). **Заменить файлами:** проектный `ralph.project.md`
(общий `ralph.md` — как есть); baseline `security-audit.baseline.json` (начать с пустого);
`tunnelCheck`/`provision/` — специфика VDS-в-РФ, в другом окружении просто выключить.

**Обязательная внешняя инфраструктура** (без неё петля слепа или молчит):

- gh CLI авторизован; `claude` CLI как нативный бинарь; Linux (`/proc/<pid>/cmdline`
  в `isMonitorProcess`, systemd в tunnelCheck);
- метки `complexity:{low|medium|high|expert}` (роутинг моделей), `area:*`, `blocked`,
  `backlog`; без `complexity:*` карточку не видит роутинг (правило #142);
- доска GitHub Projects с single-select полем `Status` и опцией `Done` (project-sync);
- конвенция «фаза = milestone, ветка фазы = `feature/…`», issues заведены до старта;
- секреты в env-файле (`/root/ralph.env`): `RALPH_TG_*` (prod требует, fail-closed),
  `GH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, опционально `RALPH_EXPECTED_EGRESS`/`SS_SERVER`.

**Честная цена переноса.** Код — меньшая часть. Дорогое — институты и дисциплина:
конвейер PRD → `plan-phase` → `issues` с проверяемыми критериями готовности в каждой
карточке (кодер-сессия работает ровно настолько хорошо, насколько написан issue),
размеченный milestone до старта фазы, доска, привычка гнать конфиг фазы через
`origin/main` (раннер локальных правок не видит), и человек, читающий пуши. #204
снимает только механическую часть; окупается со второго проекта.

## Чему научили инциденты

- Тесты дошли до настоящего git живого прогона (#138) → DI-предохранитель
  `guardSideEffect` + журнал побочек + общий afterEach (расширен после ревью #141:
  один канал из четырёх — мало).
- Сканер может ослепнуть (npm audit вернул ноль при непустом baseline) → `looksBlind`
  краснит гейт вместо ложно-зелёного.
- Чини-сессия сама дописала baseline и прошла гейт (инцидент 22.07, #207) →
  `baseline-policy.mjs`: права по git-фактам, а не по суждению модели; апстрим-дрейф —
  авто+пуш, «сам притащил» — красный.
- Тот же класс в разборе blocked (#217): чини-сессия сама снимала label blocked и
  фаза ехала к мерджу без переоценки → снятие метки — прерогатива РАННЕРА, не
  кодер-сессии. Раннер сам снимает метку и гоняет ПОВТОРНОЕ ревью (`removeBlockedLabel`
  плюс инлайн re-review в ветке `gate === 'blocked'`), метку возвращает ревью, если блок
  устоял. Планка `strongerReviewModel`/`reviewModelRank` держит модель повторного ревью не
  слабее поставившей блок (`state.reviewModelFloor`) — иначе эскалацию обходят удешевлением
  ревьюера (haiku после блока от fable).
- Гейт исполняет код гейта из дерева проверяемого PR (#209, **открыто**) — PR может
  выхолостить `enforceBaselinePolicy` или подложить `.npmrc`; при правках вокруг гейта
  помни: этот класс ещё не закрыт.
- #217 автоматизировало снятие `blocked`, но лишило человека способа сказать «этот PR не
  мерджить» — любая его метка `blocked` теперь снималась раннером наравне с ревьюерской
  (#222). Отдельная метка `hold`, проверяется в `tryMergePhase` ПЕРВОЙ (сильнее `blocked`),
  и в коде нет функции её снятия — структурный барьер надёжнее промпта: снять может
  только человек руками через `gh pr edit --remove-label hold`.
- `next/font/google` сделал `npm run build` зависимым от сети — транзиентный чих красил
  гейт и сжигал чини-сессию (#206, закрыт переходом на `next/font/local`): чеки гейта
  не должны ходить в сеть.
- Позиционный `phaseIndex` разъехался с реальностью (M7) → фаза по имени milestone +
  инвариант C4 «все предыдущие фазы реально смерджены» на каждом старте.
- Русское «Закрывает #N» GitHub не распознаёт (#130) — ключевые слова автозакрытия
  только английские, это прошито в промптах сдачи.
