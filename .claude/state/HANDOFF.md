# Session Handoff

**Дата**: 2026-07-20

## Текущая задача

Прод-режим ralph: **среда развёрнута и проверена вживую**. Открыт PR #93
(provisioning + PRD/plan под Timeweb). Дальше — Фаза 1: Linux-порт `ralph.js`
(#66-70) и фикс красного typecheck на main.

## Последние принятые решения

- **Среда = Timeweb Cloud VDS в РФ** (Москва, id 8636157, 4CPU/8GB), НЕ зарубежный
  UltaHost/Frankfurt. Управление через Timeweb MCP. Оплата с РФ-карт. См. память
  [[project-ralph-prod-env-timeweb]].
- **Инверсия прокси**: сервер в РФ → api.anthropic.com даёт Cloudflare-403 →
  Shadowsocks-туннель к Outline Димы во Франкфурте (ss-local→privoxy→HTTPS_PROXY).
  Проверено: claude под Max-подпиской ходит через туннель. IP/порт прокси НЕ светить.
- **Auth claude на сервере** = подписка через `claude setup-token` (не API-ключ):
  бесплатно, ночью не конкурирует с локальной работой, auto-wait страхует лимит.
- **VirtualBox выкинута** — обкатка provisioning на эфемерном Timeweb-VDS через MCP.
- Provisioning готов: `.claude/ralph/provision/` (provision.sh + env.example + README).
- **typecheck красный на чистом clone** (208 ошибок, нет vitest/globals в tsconfig);
  локально маскируется incremental-кэшем `.tsbuildinfo` → дыра в ralph-гейте.
- **VDS гасится в golden-образ между сессиями** (простой = 21₽/мес vs 2001₽). Образ
  `image_id=21e4be00-b788-4da4-baab-a6449fabbaf7` (20₽/мес). Удаление VDS — через панель
  (MCP не умеет; IPv4 удалить отдельно). Восстановление: `create_server` с image_id + новый IPv4.

## Следующие шаги

1. Смерджить PR #93, затем закрыть #68 (systemd-пункт — в Фазу 2).
2. Фикс typecheck: `types:["vitest/globals"]` в tsconfig (отдельный PR).
3. Фаза 1 (#66-70): прогнать `ralph.js --dry-run` на VDS, портировать под /bin/sh.

## Open questions

- Ротировать ли токены (CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, ss-пароль прошли через чат)?
- systemd-запуск ralph упрётся в prod-профиль (Фаза 2) — его в коде ещё нет.
