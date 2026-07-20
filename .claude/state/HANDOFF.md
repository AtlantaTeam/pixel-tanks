# Session Handoff

**Дата**: 2026-07-20

## Текущая задача

Прод-режим ralph, **Фаза 1 закрыта** + **первый боевой AFK-прогон с прод-VDS
пройден целиком** (issue #99 — рефактор `main()` → `preflight()`/`runLoop()`,
долг из ревью #97): кодер-сессия → PR #102 → ревью → правки → зелёный гейт
(build/lint/lint:fsd/typecheck/test) → авто-мердж squash. Дальше — **Фаза 2**
(#71–75, профили playground/prod).

## Последние принятые решения

- **Ralph — только в tmux, никогда через фоновый Bash-тул claude.** Первая
  попытка прогона умерла вместе с закрывшейся claude-сессией ровно на шаге
  гейта (несмотря на то что процесс выглядел «отвязанным от терминала» —
  похоже, Claude Code подчищает свои фоновые задачи сам, SIGHUP тут ни при
  чём). Вторая попытка — `tmux send-keys` напрямую, минуя claude — дошла до
  конца. Задокументировано: `docs/ralph-prod-mode/vds-sessions.md`.
- **VDS-инфра для tmux уже готова**: `/root/.tmux.conf`, сессия `work`,
  alias `w` в `.bashrc`. Issue #103 (backlog) — штатный запуск ralph
  (tmux-паттерн или systemd БЕЗ `Restart=always` — fail-closed стопы ralph
  осознанные, слепой рестарт жёг бы API-лимит).
- **Гигиена доски**: GitHub Projects workflow «Item closed → Status: Done»
  включён, но не срабатывает (нашли и вручную поправили 5 issues, зависших
  в «In Progress» при закрытом issue: #30–33, #99) — причина не выяснена
  (GraphQL не даёт посмотреть конфиг маппинга поля воркфлоу), нужна ручная
  проверка в UI проекта.
- **`tsconfig.json` был красным на чистом клоне** (vitest globals не
  резолвились для `tsc`) — фикс `vitest-globals.d.ts` (PR #100), не трогать
  `"types"` в tsconfig (отключил бы остальные `@types/*`).
- **`IS_SANDBOX=1` обязателен в ralph.env на VDS** — под root Claude Code
  блокирует `--permission-mode bypassPermissions` без него (PR #101).

## Следующие шаги

1. **Фаза 2 (#71–75)**: профили playground/prod, прод-milestone в
   `ralph.config.json` (сейчас там временно только фаза долга — уже смерджена,
   конфиг нужно наполнить заново под Фазу 2).
2. Issue #103 (backlog): штатный AFK-запуск ralph без ручного tmux.

## Open questions

- Ротировать ли токены (CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, ss-пароль прошли через чат)?
- Инфра: [[project-ralph-prod-env-timeweb]] (VDS Москва + Shadowsocks к Франкфурту).
  Golden-образ `image_id=6eec16c4-9719-4477-85f2-a5e2144b9fcf`.
