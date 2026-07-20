# Session Handoff

**Дата**: 2026-07-20

## Текущая задача

Прод-режим ralph, **Фаза 1 (Linux-порт)**: #66, #67, #70 смерджены. **#69 (юнит-тесты)
— готов, НЕ закоммичен** (на main, ждёт ветку+PR). Осталось #92 (health-check туннеля —
вживую подтверждён). Дальше — Фаза 2 (профили playground/prod).

## Последние принятые решения

- **#69 сделан**: ralph.js отрефакторен под тестируемость — вынесены чистые функции
  `buildClaudeArgs` (ядро порта, построение argv) и `formatExcerpt` (хвост excerpt);
  `config` → module-level `let`, весь exec (preflight+loop) в `main()` под guard
  `require.main === module` (import в тестах не запускает loop). Экспорт через
  `module.exports`. Тесты рядом: `.claude/ralph/ralph.test.js` (33 теста), vitest
  `include` расширен на `.claude/ralph/**/*.test.{js,ts}`.
- **Прогон на Linux вживую (Docker node:24 Ubuntu, x86_64)**: полный `npm ci && npm run
test` зелёный — 52 файла, 372 теста, включая ralph. `parseResetWaitMs` детерминирован
  через фейк-таймеры (TZ-независим). Ключевой тест — anti-RCE: спецсимволы промпта
  проходят одним дословным argv-элементом.
- **Linux-порт (#67)**: argv-массив (`shell:false`) — убирает win32-guard `%` И RCE на
  /bin/sh. См. [[project-ralph-prod-env-timeweb]].
- **Golden-образ с кодом порта**: `image_id=6eec16c4-9719-4477-85f2-a5e2144b9fcf`.
  VDS/образ/IPv4 удаляются ТОЛЬКО через панель. Простой = 21₽/мес.

## Следующие шаги

1. #69: ветка + коммит (`test(ralph): юнит-тесты порта + рефактор под тестируемость`) + PR.
2. #92: health-check туннеля в ralph.js перед итерацией (вживую подтверждён).
3. Фаза 2 (#71-75): профили playground/prod, добавить прод-milestone в ralph.config.json.

## Open questions

- Ротировать ли токены (CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, ss-пароль прошли через чат)?
