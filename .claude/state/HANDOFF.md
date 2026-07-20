# Session Handoff

**Дата**: 2026-07-20

## Текущая задача

Прод-режим ralph, **Фаза 1 (Linux-порт)**: #66, #67, #70 смерджены. **#69 (юнит-тесты)
— открыт PR #97** (`test/ralph-port-unit-tests`), пройдено ревью, замечания разобраны —
ждёт финального мерджа. Осталось #92 (health-check туннеля — вживую подтверждён).
Дальше — Фаза 2 (профили playground/prod).

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

## Следующие шаги

1. Смерджить PR #97 (#69 закрывается им).
2. #92: health-check туннеля в ralph.js перед итерацией (вживую подтверждён).
3. Фаза 2 (#71-75): профили playground/prod, добавить прод-milestone в ralph.config.json.

## Open questions

- Ротировать ли токены (CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, ss-пароль прошли через чат)?
