# Session Handoff

**Дата**: 2026-07-19

## Текущая задача

Прод-режим ralph: цепочка **prd → plan-phase → issues ПРОЙДЕНА**. Заведены 6 milestones +
25 issues (#66-90) на `AtlantaTeam/pixel-tanks`, все на доске (проект #1). Docs:
`docs/ralph-prod-mode/{prd.md, plan.md}`. Дальше — брать Фазу 1 руками (НЕ через loop).

## Последние принятые решения

- **PRD переписан по факту кода `ralph.js`**: circuit breaker, self-heal, авторазбор blocked,
  merge-retry, API-лимит auto-wait, роутинг, 5-чек гейт+LLM-ревью — УЖЕ есть, не todo.
- **Среда прод-режима — удалённый Linux-сервер вне РФ** (Frankfurt): снимает прокси/Cloudflare-403,
  разгружает комп. Обкатка Linux-порта сперва в **локальной VirtualBox** (бесплатно), тем же
  provisioning-скриптом — на сервер. VDS: UltaHost Enterprise 4CPU/6GB/100GB, БЕЗ GPU.
- **Канал пушей — Telegram-бот, односторонний** (бот→человек). Двусторонний контроль (read-only
  → мутирующие команды) — в бэклог с event-триггерами.
- **Milestone-префикс «Прод-режим ralph ·»** — чтобы не путать с game-next «Фаза 1-9».
- **Фаза 1 = Linux-порт (входной билет)**: ralph.js гонялся только на Windows; spawnSync shell:true
  → /bin/sh, guard %/" переосмыслить. #67 и #77 (shell/ветковая хореография) = expert→fable.
- **merge→release**: деплой-таргета пока нет (pixel-tanks не деплоится) → release-стоп = «стоп+пуш»,
  деплой no-op-плейсхолдер до боевого проекта.

## Следующие шаги

1. Купить VDS (Quarterly, Frankfurt, Plain OS Ubuntu LTS; токен-поля НЕ заполнять).
2. Начать Фазу 1 (#66→#70): аудит → shell-порт → provisioning-скрипт → тесты → прогон в VirtualBox.
3. Позже: Фазы 7-10 корневого плана игры (auth, лидерборд, Яндекс ID, i18n) через скилл issues.

## Open questions

- **coverage-порог** (#82): жёсткое число или «покрытие не падает»? — решить в research.
- **Оплата зарубежного VDS с РФ-карт** — реселлер/крипта (провайдер UltaHost).
- **whichllm** — локальные модели для дешёвых задач ralph (нужен GPU-бокс, др. бюджет).
