# Session Handoff

**Дата**: 2026-07-20

## Текущая задача

Прод-режим ralph, **Фаза 1 (Linux-порт)**: #66, #67, #70, #69 — смерджены.
**#92 (health-check туннеля) — реализован, открыт PR** (`feat/ralph-92-tunnel-healthcheck`).
Смёрджится → Фаза 1 закрыта, дальше Фаза 2 (профили playground/prod).

## Последние принятые решения

- **#69 сделан (PR #97)**: ralph.js отрефакторен под тестируемость — вынесены
  `buildClaudeArgs` (ядро порта, построение argv), `formatExcerpt` (хвост excerpt) и
  `spawnClaude` (обвязка над spawnSync с инжектируемой spawn-функцией — 3-й параметр,
  дефолт настоящий spawnSync; так тестируется САМА граница anti-RCE защиты, а не
  только сборка argv, и не через `vi.mock('node:child_process')` — тот на границе
  CJS require() ненадёжен). `config` → module-level `let`, весь exec (preflight+loop)
  в `main()` под guard `require.main === module`. Тесты рядом:
  `.claude/ralph/ralph.test.js` (37 тестов). vitest переведён на `test.projects`:
  отдельный project `ralph` (environment node, без DOM-setupFiles приложения) для
  `.claude/ralph/**/*.test.{js,ts}`, `app` — прежнее поведение для `src/**`.
- **Прогон на Linux вживую (Docker node:24 Ubuntu, x86_64), на исходном коммите PR**:
  полный `npm ci && npm run test` зелёный — 52 файла, 372 теста, включая ralph.
  `parseResetWaitMs` детерминирован через фейк-таймеры (TZ-независим). После доразбора
  ревью (spawnClaude + projects) прогнано локально на Windows — 52 файла, 376 тестов
  зелёные; повторный Linux-прогон не делали, риска платформозависимости в добавленном
  коде нет (те же паттерны, что уже были верифицированы на Linux).
- **Linux-порт (#67)**: argv-массив (`shell:false`) — убирает win32-guard `%` И RCE на
  /bin/sh. См. [[project-ralph-prod-env-timeweb]].
- **Golden-образ с кодом порта**: `image_id=6eec16c4-9719-4477-85f2-a5e2144b9fcf`.
  VDS/образ/IPv4 удаляются ТОЛЬКО через панель. Простой = 21₽/мес.

## Последнее (#92)

Health-check в ralph.js: `ensureTunnel(config, deps)` перед КАЖДОЙ claude-сессией
(единая точка — начало `runClaude`). Сверяет egress через прокси (`curl -x $HTTPS_PROXY
api.ipify.org`) с ожидаемым IP (`RALPH_EXPECTED_EGRESS`/`SS_SERVER`). Красный →
`systemctl restart ss-local+privoxy` → повторная сверка → всё ещё красный: `process.exit(1)`
(fail-closed, не жжём лимит) + `pushEvent` (заглушка-лог, реальная доставка — Фаза 5).
Чистые/DI-функции `tunnelHealthy`/`ensureTunnel`/`tunnelCheckEnabled` экспортированы,
13 юнит-тестов. Включение: `config.tunnelCheck.enabled` (дефолт false, dev не ломается)
ИЛИ env `RALPH_TUNNEL_CHECK=1` (в ralph.env на VDS — мост до профилей Фазы 2).

## Следующие шаги

1. Смерджить PR #92-туннель → Фаза 1 закрыта.
2. Долг от ревью #97: issue на разбиение `main()` (~370 строк) на `preflight()`/`runLoop()`.
3. Фаза 2 (#71-75): профили playground/prod, прод-milestone в ralph.config.json.

## Open questions

- Ротировать ли токены (CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, ss-пароль прошли через чат)?
