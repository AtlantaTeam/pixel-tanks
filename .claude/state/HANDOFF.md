# Session Handoff

**Дата**: 2026-07-20

## Текущая задача

Прод-режим ralph, **Фаза 1 (Linux-порт + provisioning) — ЗАВЕРШЕНА и ЗАКРЫТА**
(milestone #10, 6/6 issues: #66/#67/#70/#69/#92/#93). Смерджено в `main` (`f0aaece`).
Дальше — **Фаза 2** (профили playground/prod).

## Прод-среда — LIVE (развёрнута 2026-07-20)

VDS `ralph-prod` **id 8638987, IPv4 186.246.7.204**, Москва, из golden-образа. Туннель
(ss-local+privoxy) жив, egress Франкфурт `79.133.42.198`, `claude -p` через туннель
отвечает. Репо `/root/pixel-tanks` на `main`. `/root/.bashrc` авто-грузит `/root/ralph.env`
→ в терминале VS Code сразу есть прокси/OAuth/GH_TOKEN/`RALPH_TUNNEL_CHECK=1`. Подключение:
VS Code Remote-SSH хост `ralph-prod` (в `~/.ssh/config`), папка `/root/pixel-tanks`.
Тарификация ~2001₽/мес — по завершении снять образ и удалить VDS+IPv4 через панель (→21₽).
Детали: [[project-ralph-prod-env-timeweb]].

## Что сделано в Фазе 1

- **Linux-порт (#67)**: `runClaudeOnce` → argv-массив (`shell:false`) вместо shell-строки:
  убирает win32-guard `%` И закрывает RCE на /bin/sh. Проверено вживую на Linux VDS (#70)
  и в Docker node:24 (полный `npm ci && npm test` зелёный).
- **Юнит-тесты + рефактор под тестируемость (#69, PR #97)**: чистые/DI-функции
  `buildClaudeArgs(cfg)`, `spawnClaude(spawnFn)`, `formatExcerpt`, `parseResetWaitMs`;
  `config` → module-level `let`, весь exec в `main()` под guard `require.main === module`.
  vitest `test.projects`: отдельный node-project `ralph` (без DOM-setupFiles).
- **Health-check туннеля (#92, PR #98)**: `ensureTunnel(cfg, deps)` перед КАЖДОЙ
  claude-сессией (начало `runClaude`, под `!DRY`-guard). Сверяет egress через прокси
  (`execFileSync curl -4 -x $HTTPS_PROXY api.ipify.org`) с ожидаемым IP
  (`RALPH_EXPECTED_EGRESS`/`SS_SERVER`, тримленный). Красный → `systemctl restart` →
  повторная сверка → всё ещё красный: `process.exit(1)` (fail-closed) + `pushEvent`
  (заглушка-лог, реальная доставка — Фаза 5). Включение: `config.tunnelCheck.enabled`
  (дефолт false) ИЛИ env `RALPH_TUNNEL_CHECK=1` (на VDS).

## Ключевые паттерны раннера (соблюдать в Фазе 2+)

- Побочные вызовы (curl/systemctl/spawn) — через `execFileSync`/argv, НЕ `sh()`/shell
  (anti-RCE, #67). Зависимости и `config` — параметрами функций (тестируемость + DI).
- В тестах побочки мокать инъекцией функции, НЕ `vi.mock` — см. [[reference-ralph-test-di-not-vimock]].
- Любой новый побочный вызов в раннерном пути — под `!DRY`-guard (dry-run строго read-only).

## Следующие шаги

1. **Фаза 2 (#71-75)**: профили playground/prod, прод-milestone в ralph.config.json.
2. Долг от ревью #97: issue на разбиение `main()` (~370 строк) на `preflight()`/`runLoop()`.

## Open questions

- Ротировать ли токены (CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, ss-пароль прошли через чат)?
- Инфра: [[project-ralph-prod-env-timeweb]] (VDS Москва + Shadowsocks к Франкфурту).
  Golden-образ `image_id=6eec16c4-9719-4477-85f2-a5e2144b9fcf`.
