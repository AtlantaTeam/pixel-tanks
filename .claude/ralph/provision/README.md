# Provisioning прод-режима ralph

Разворачивание раннера ralph на удалённом Linux-сервере с нуля. Проверено на
**Timeweb Cloud VDS, Ubuntu 24.04 LTS, 4CPU/8GB** (Москва, ru-3).

## Архитектура среды

```
                    ┌─────────────────────── VDS (Timeweb, РФ, Москва) ───────────────────────┐
                    │  ralph.js / claude CLI                                                   │
   человек ── SSH ──┤     │ HTTPS_PROXY=http://127.0.0.1:8118                                  │
                    │     ▼                                                                    │
                    │  privoxy :8118 ──► ss-local :1080 ──Shadowsocks──►  Outline (Франкфурт)  │──► api.anthropic.com
                    │                                                                          │
                    │  git / gh / npm ───────────── напрямую из РФ (NO_PROXY) ─────────────────┼──► github.com / npm
                    └──────────────────────────────────────────────────────────────────────────┘
```

**Почему так:** сервер в РФ (данные по 152-ФЗ, оплата с РФ-карт), но `api.anthropic.com`
из РФ отдаёт Cloudflare-403 → трафик к Anthropic заворачивается через Shadowsocks-туннель
на Outline-сервер во Франкфурте (egress = немецкий IP). GitHub/npm из РФ работают напрямую —
их через туннель не гоним (быстрее, меньше нагрузка на туннель).

## Порядок развёртывания

### 0. Создать VDS (Timeweb MCP или панель)

- Ubuntu 24.04, preset 4CPU/8GB (в наличии — Москва `preset_id=4803`; СПб/НСК бывают без ёмкости).
- Прописать SSH-ключи при создании.
- **Добавить публичный IPv4** — тариф по умолчанию выдаёт IPv6-only
  (`add_server_ip type=ipv4` или панель). Без IPv4 нет ни SSH, ни туннеля.

### 1. Подготовить секреты (руками, на машине с браузером)

- `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` (подписка Max, headless-токен).
- `gh auth token` (или создать PAT scope `repo`) → `GH_TOKEN`.
- Outline Manager → access-key → из него `SS_PASSWORD` (метод/host/port — см. `ralph.env.example`).

### 2. Заполнить env

```bash
cp ralph.env.example ralph.env
# заполнить CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, SS_PASSWORD
```

### 3. Залить и запустить провижн

```bash
scp provision.sh ralph.env root@<ip>:/root/
ssh root@<ip> 'chmod 600 /root/ralph.env && ENV_FILE=/root/ralph.env bash /root/provision.sh'
```

Скрипт идемпотентен, ставит всё окружение и падает с явной ошибкой, если туннель
не поднялся (health-check egress ≠ Франкфурт).

### 4. Проверить

```bash
ssh root@<ip>
set -a && . /root/ralph.env && set +a
cd /root/pixel-tanks
claude -p 'Ответь одним словом: OK'          # → OK (через туннель)
curl -x http://127.0.0.1:8118 https://api.ipify.org   # → IP Франкфурта
npm run build && npm run test                # гейт-чеки
```

## Изоляция раннера: выделенный git worktree (#76)

`ralph.js` работает не в `/root/pixel-tanks` (дерево человека — VS Code Remote-SSH,
ручные правки, `git status`/`checkout`), а в **отдельном linked worktree**, соседнем
с репозиторием: `/root/pixel-tanks-ralph`. Так `git checkout`/`git status` внутри
loop (гейт мерджа, сборка чеков) не видят и не трогают то, что человек одновременно
делает в своей копии — раньше общее дерево ломало `ensureClean` при любой ручной
правке посреди AFK-прогона.

**Создаётся раннером сам, при первом запуске** — провижн ничего для этого делать не
должен. `ralph.js` при старте (кроме `--dry-run`, который строго read-only):

1. Резолвит путь: `cfg.runnerWorktreePath` (поле `ralph.config.json`) → иначе env
   `RALPH_WORKTREE_PATH` → иначе дефолт-сосед `../pixel-tanks-ralph`.
2. Если по этому пути уже зарегистрирован `git worktree` — переиспользует.
3. Если пути нет — `git worktree add <path> --detach` (детач, не ветка: на этот
   момент раннер ещё не знает нужную ветку фазы, а `main` почти всегда уже занят
   деревом человека — git не даёт одну ветку в двух worktree одновременно) и сразу
   `npm ci` там же (`git worktree add` линкует только git-отслеживаемые файлы,
   `node_modules` не приезжает — без установки первый же гейт-чек упал бы).
4. Переключает `cwd` процесса на этот worktree — весь дальнейший loop (state,
   log, git-хореография гейта, npm-чеки) работает уже там.
5. Если путь занят чем-то, что НЕ зарегистрировано как worktree этого репозитория
   (мусор от ручного `rm -rf` вместо `git worktree remove`) — раннер **не трогает
   и не угадывает**, останавливается с понятной ошибкой: разбор за человеком.

**Проверить руками:**

```bash
cd /root/pixel-tanks && node .claude/ralph/ralph.js --dry-run   # read-only: worktree не создаёт, но если он уже поднят — читает state ОТТУДА (chdir туда же), чтобы предсказывать живой запуск
git worktree list                                                # после живого прогона — два дерева
tail -f /root/pixel-tanks-ralph/.claude/ralph/monitor.out        # монитор тоже живёт в worktree раннера
```

**Если `package.json` в ветке фазы добавил новую зависимость** — раннер справляется
сам: перед прогоном гейт-чеков он сверяет хэш `package-lock.json` PR-головы с маркером
последнего `npm ci` (`.claude/ralph/.deps-lock.sha` в дереве раннера) и при расхождении
переустанавливает зависимости (`npm ci`) до чеков. Руками ничего делать не нужно; если
`npm ci` всё же упадёт (битый lock/сеть) — гейт станет красным, и чини-сессия получит
текст ошибки про отсутствующий модуль.

## Аутентификация: два независимых механизма

На VDS сосуществуют **два способа** авторизации Claude, и они конфликтуют. Разница
критична — на ней уже терялось по релогину каждое утро (21.07.2026).

|              | Интерактивный `claude` (человек в tmux) | Headless `claude -p` (ralph)            |
| ------------ | --------------------------------------- | --------------------------------------- |
| Где хранится | `~/.claude/.credentials.json`           | `CLAUDE_CODE_OAUTH_TOKEN` в `ralph.env` |
| Как получен  | `claude` → логин в браузере             | `claude setup-token`                    |
| Access-токен | живёт ~8 ч                              | статичная строка в файле                |
| Обновление   | **сам**, по refresh-токену (~1 мес)     | никак — файл не обновляется             |

**Приоритет: env-переменная перебивает `.credentials.json`.** Отсюда ловушка: если
`ralph.env` грузится автоматически в интерактивный шелл, `claude` берёт из env
статичный headless-токен, тот протухает — и CLI просит логин. Логин пишет свежие
креды в файл, но следующий шелл снова экспортирует протухший env-токен → **релогин
каждое утро по кругу**, потому что чинился файл, который не использовался.

**Решение — в `/root/.bashrc`:** `ralph.env` по-прежнему грузится (нужны `HTTPS_PROXY`,
`NO_PROXY`, `GH_TOKEN`), но следом идёт `unset CLAUDE_CODE_OAUTH_TOKEN`. Интерактивный
`claude` живёт на своих кредах с авто-рефрешем; для ralph полный env поднимается явно
алиасом `ralph-env`.

```bash
# ~/.bashrc
if [ -f /root/ralph.env ]; then set -a; . /root/ralph.env; set +a; fi
unset CLAUDE_CODE_OAUTH_TOKEN   # иначе перебьёт ~/.claude/.credentials.json
alias ralph-env='set -a; . /root/ralph.env; set +a; echo "ralph.env загружен (вкл. CLAUDE_CODE_OAUTH_TOKEN)"'
```

> **Перед запуском ralph — обязательно `ralph-env`**, иначе headless-сессия стартует без токена.
> `.bashrc` лежит вне git: при пересоздании VDS из образа он приезжает вместе с диском,
> но при чистом провижне правку надо внести руками.

### `unset` действует только на новые шеллы

Правка `.bashrc` и ротация токена меняют **файлы**, а не окружение уже работающих
процессов — env запущенного процесса извне не переписывается. Долгоживущие процессы
(tmux-сервер, vscode-server, открытая сессия `claude`), поднятые до правки, продолжают
держать в памяти старый токен и раздают его всем своим потомкам: tmux-сервер наследует
env один раз, от создавшего его клиента, и отдаёт этот снимок каждому новому окну — до
`tmux kill-server`.

Поэтому после правки `.bashrc` или ротации токена — **пересоздать сессию**, а не открывать
новое окно в старой:

```bash
tmux kill-session -t work && w      # заново, уже с чистым env
# диагностика конкретного процесса:
tr '\0' '\n' < /proc/<pid>/environ | grep CLAUDE_CODE_OAUTH_TOKEN
```

Разовый обход без пересоздания — `env -u CLAUDE_CODE_OAUTH_TOKEN claude`, но это лечение
симптома: соседние процессы остаются с протухшим токеном.

### Ротация headless-токена

Токен `sk-ant-oat01-…` статичен и не отзывается из CLI — ротируем вручную:

```bash
claude setup-token                                     # выпустить новый (нужен браузер)
bash .claude/ralph/provision/update-token.sh           # вклеить в ralph.env (ввод скрытый)
```

Скрипт проверяет префикс, кладёт бэкап `ralph.env` рядом (`chmod 600`), пишет токен
через env-переменную (не через argv — не виден в `ps`) и прогоняет smoke-тест
`claude -p 'OK'` через туннель.

**Старый токен отзывать вручную** в настройках аккаунта на claude.ai — CLI такого не
умеет, до отзыва он остаётся действующим. `claude setup-token` может попутно
перезаписать `.credentials.json`; если после ротации CLI попросит логин — залогиниться
один раз, дальше снова тихо.

## Подводные камни (уже учтены в provision.sh)

| Симптом                                                       | Причина                                                                                                                                      | Решение                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ss-local`: `Invalid config path`, юнит `failed`              | пакетный юнит `shadowsocks-libev-local@` с `DynamicUser=true` → случайный uid не читает конфиг `600`                                         | drop-in override: `User=root` + `Restart=always`                        |
| `npm ci`: postinstall не выполнены (esbuild/sharp)            | npm 11 блокирует lifecycle-скрипты (allow-scripts)                                                                                           | `npm rebuild esbuild sharp unrs-resolver`                               |
| claude: `workspace has not been trusted`, игнорит permissions | нет trust-флага для папки                                                                                                                    | `hasTrustDialogAccepted:true` в `~/.claude.json`                        |
| claude каждое утро просит логин, хотя вчера логинился         | `ralph.env` в `.bashrc` экспортирует статичный `CLAUDE_CODE_OAUTH_TOKEN`, он перебивает авто-обновляемые `.credentials.json`                 | `unset CLAUDE_CODE_OAUTH_TOKEN` в `.bashrc` — см. «Аутентификация» выше |
| `/model`: Fable недоступен, предлагает купить usage credits   | сессия поднята со старым `CLAUDE_CODE_OAUTH_TOKEN` в env: токен статичен и несёт снимок прав на момент выпуска — новых entitlement в нём нет | пересоздать сессию tmux — см. «`unset` действует только на новые шеллы» |
| VDS без публичного IPv4                                       | тариф Timeweb выдаёт IPv6-only                                                                                                               | `add_server_ip type=ipv4`                                               |

## Экономия между сессиями: свернуть VDS в образ

Выключенный VDS у Timeweb **тарифицируется полностью** (ресурсы зарезервированы). Чтобы не
платить ~2000 ₽/мес в простое — снять образ и удалить сервер.

Пошаговый runbook (свернуть/развернуть, точные ID) — **`docs/deploy/vds-fold-restore.md`**.

Коротко: `create_image(server_id)` → удалить сервер через панель. Прод-адрес
`186.246.7.204` — **floating IP** (отдельный ресурс), поэтому его **НЕ удаляем**: держим
за 180 ₽/мес и при восстановлении пере-привязываем (`bind_floating_ip`) — **DNS не
трогаем, IP тот же**. (Раньше здесь советовалось удалять IPv4 и брать новый — при живом
floating IP это лишняя возня с DNS каждый restore.) AAAA-запись (IPv6) — удалить, живём на
IPv4.

> `image_id` актуального образа — в `.claude/state/HANDOFF.md` и памяти проекта, не хардкодим.

## Осталось (не в этом скрипте — Фазы 1-2 плана)

- **Linux-порт `ralph.js`** — писался под Windows (`spawnSync shell:true` → `/bin/sh`,
  guard `%`/`"` под cmd.exe). Прогнать `--dry-run`, починить (#66–70).
- **systemd-юнит для ralph** + health-check туннеля перед итерацией — после prod-профиля.

Прод-профиль (`--profile prod`) реализован в Фазе 2 (#71–75). Запускать **из корня репо**:
пути в `ralph.js` относительные, из `.claude/ralph/` конфиг не найдётся.

```bash
cd /root/pixel-tanks && set -a && . /root/ralph.env && set +a && node .claude/ralph/ralph.js --profile prod
```
