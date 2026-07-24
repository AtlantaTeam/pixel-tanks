# Research: дизайн-система и консистентность визуальных интерфейсов

**Дата**: 2026-07-24 · **Метод**: deep-research harness (6 углов → 25 источников → 111 фактов → 25 верифицировано, все 3-0, 0 опровергнуто) · **Связано с**: #262 (переносимость ralph), #265 (баг бабла — симптом отсутствия дизайн-барьера).

## Вопрос

Инструменты дизайн-системы и консистентности UI, применимые (а) в pixel-tanks (Next 16 / React 19 / TS / Tailwind 4 / FSD / своя `shared/ui` с пиксельной темой) и (б) в **автономной headless-петле** (ralph loop: `claude -p` пишет код → детерминированный гейт → мердж), с прицелом на переносимость. Главный критерий: инструмент должен встраиваться в **неинтерактивный** цикл — GUI-редакторы, куда ходит только человек, не годятся как механизм консистентности.

## Вывод

Строгую дизайн-систему в headless-петле держит **не GUI-редактор, а код-нативный барьер**: `токены = конфиг, линт + визрегрессия = гейт`. Это ровно принцип проекта «барьеры важнее промптов».

## 1. Верификация 4 названных инструментов

| Инструмент                               | Что это                                                                                                                                   | Статус                                                            | Headless-петля                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Pencil.dev** (pen.dev)                 | design-to-code, визуальный canvas + локальный MCP (a16z Speedrun); генерит React+Tailwind, `.pen` в git                                   | реальный                                                          | **Частично** — MCP это мост к **запущенному desktop-приложению**; headless относится к агенту, не к редактору               |
| **OpenPencil** (open-pencil/open-pencil) | MIT, open-source Figma-альтернатива, self-host; MCP (stdio+HTTP, 100+ tools) + headless CLI `op` + CLI-линтер                             | реальный, но **очень молодой** (создан 2026-02-27, «rough edges») | **Частично** — MCP тоже «through the running app» (WebSocket)                                                               |
| **«Claude Design»**                      | **разобрано** (см. §1a): облако `claude.ai/design` + встроенная `/design-sync` + Claude Design MCP-мост; голого `/design` как команды нет | identified                                                        | **Частично / ассист** — генерация требует человека, `/design-login` = браузер; на `api.anthropic.com` (та же РФ-блокировка) |
| **«Open Design»**                        | нашёлся `open-design.ai` (agent-native workspace), но факты не пережили верификацию (blog-качество)                                       | не верифицирован                                                  | —                                                                                                                           |

### §1a. Разбор «Claude Design» / `/design` (open question #1 — закрыт)

_Источник: агент `claude-code-guide`, 2026-07-24; docs.claude.com/commands, support.claude.com._

- **Голого `/design` как встроенной команды НЕТ** в текущем `claude --help` и офиц. доках. Упоминания `/design` на сторонних сайтах (theplanettools.ai, июнь 2026) — неточность либо анонс, не подтверждено.
- Реально существует **Claude Design** — облачный дизайн-инструмент `claude.ai/design`, интегрированный с CLI двумя путями:
    - **`/design-sync`** (встроенная команда, есть в docs) — конвертит React-дизайн-систему из репо (Storybook/компоненты) и заливает в `claude.ai/design`. Можно вызвать с `-p` (одноразовый синк). Первый синк большого репо — часы.
    - **Claude Design MCP** — двусторонний мост (`claude mcp add --transport http claude-design https://api.anthropic.com/v1/design/mcp`), `/design-login` требует браузера.
- **Headless**: только `/design-sync -p` для уже готовой дизайн-системы (разово); сама разработка дизайна — интерактивная, не для `claude -p`.
- **Барьер или ассист**: **ассист**. Нет детерминированного pass/fail-валидатора консистентности → не гейт.
- **РФ**: живёт на `api.anthropic.com` / `claude.ai` — та же блокировка, что мы обходим Shadowsocks-туннелем (Франкфурт). Без туннеля недоступно (частично закрывает open question #3 для Anthropic-инструментов).
- Смежное в Claude Code: `/dataviz` (палитры, ассист), `/output-styles`, custom skills, `/design-sync` — **ни один не даёт детерминированный гейт консистентности**.

**Вывод**: «Claude Design» — тот же класс, что Pencil/OpenPencil: дизайн-коллаборация человек↔агент, а не барьер для автономной петли. Подтверждает вывод §2–3: консистентность в headless держит код-нативный барьер, не дизайн-инструмент.

## 2. Что реально применимо в ralph-петле (код-нативный стек)

Редакторы Pencil/OpenPencil требуют запущенного локального приложения → плохо для чистого `claude -p`. Настоящий детерминированный барьер (работает через exit-code, без GUI и человека):

- **Токены = источник правды**: W3C **DTCG** + **Style Dictionary v4** (first-class DTCG-поддержка; собирает CSS/JS/TS на билде).
- **Линт-барьер «только токены»**:
    - ⭐ **`@poupe/eslint-plugin-tailwindcss`** (MIT) — единственный заточенный под **Tailwind 4 `@theme`**: `prefer-theme-tokens` (автофикс `bg-[var(--primary)]` → `bg-primary`) + `no-arbitrary-value-overuse`.
    - `francoismassart/eslint-plugin-tailwindcss` 4.x (latest 4.2.0, 2026-07-13, «Made for Tailwind v4») — `no-arbitrary-value` (запрет `w-[137px]`), `no-custom-classname`.
    - `eslint-plugin-better-tailwindcss` (schoero) — Tailwind 3+4, `no-unknown-classes`, `no-restricted-classes`.
- **Визуальная регрессия как гейт** (pass/fail по exit-code):
    - **Playwright `toHaveScreenshot`** — у нас Playwright уже есть, бейзлайны в репо, без SaaS.
    - **Loki** (oblador/loki, MIT) — Storybook VRT, self-host, Chrome-in-docker → OS-независимо; бесплатная альтернатива Chromatic.
    - **reg-suit** (reg-viz, MIT) — чистый CLI, HTML diff-отчёт, любой CI.

## 3. Рекомендация для pixel-tanks сейчас

1. Оставить `@theme`-токены (`globals.css`) источником правды (при росте — вынести в DTCG + Style Dictionary v4).
2. Включить **`@poupe/eslint-plugin-tailwindcss`** (`prefer-theme-tokens` + `no-arbitrary-value-overuse`) в `npm run lint` гейта — барьер «никаких bracket-значений, только токены».
3. Добавить **визуальную регрессию** (Playwright-скриншоты ключевых экранов) в гейт.
4. GUI-редактор — **не** как механизм консистентности (максимум — ассист человеку).

## 4. Переносимый «дизайн-адаптер» ralph (#262)

- **Конфиг-часть**: токен-файлы (DTCG/`@theme`) + ESLint-конфиг дизайн-правил.
- **Гейт-часть**: линт-правила + визрегрессия — чеки в `BASE_GATE_CHECKS`/`PROD_GATE_CHECKS`.
- Дизайн становится ещё одним детерминированным барьером петли → идеально в модель адаптеров #262.

## 5. Генеративная сторона: агент/скилл UI-UX (дополнение к барьеру)

Барьер (линт + визрегрессия) **предотвращает** неконсистентность, но не улучшает сам дизайн. Вторую сторону закрывает агент с сильным UI-скиллом — например **`ui-ux-pro-max`** (nextlevelbuilder/ui-ux-pro-max-skill, MIT, ~110k⭐; Python-скрипты только stdlib, без сети и установок; CSV-базы: 84 стиля, 192 палитры, 74 пары шрифтов, 161 правило по индустриям, 22 стека).

Важно по инварианту №5 «барьеры важнее промптов»: скилл — это **промпт**, он улучшает _средний_ результат, но не гарантирует консистентность. Схема:

```
СКИЛЛ (генерит хороший UI) → БАРЬЕР (линт токенов + визрегрессия) → мердж
     промпт, мягкий              exit-code, жёсткий
```

**Как встраивать в ralph:**

- Либо гайд кодер-сессии для UI-issue (ссылка в `ralph.md`);
- Либо чище — **дизайн-ревью субагент** (по образцу `architect-reviewer`/`security-reviewer`), эскалируемый на UI-пути диффа (`src/**/ui/**`, `shared/ui`) через `review.escalateOnPaths`.

**Предостережения для автономной петли (ralph = `bypassPermissions` на публичном репо):**

- **Вендорить, не тянуть вживую**: скопировать скилл в репо, запинить версию, прочитать сами инструкции и `.py` — иначе внешний репо меняется под тобой (тот же класс, что supply-chain).
- **Для pixel-tanks ценность низкая** — генератор ОБЩИХ дизайн-систем, а тема жёстко задана (Press Start 2P / Pico-8 / NES). Раскрывается для **#262** (поднять дизайн-систему новому проекту с нуля).

## Оговорки (открытые оси)

- **Доступность из РФ** ни одного инструмента не проверялась — жёсткое ограничение проекта, закрыть отдельно (особенно перед внешним редактором/SaaS).
- Pencil/OpenPencil — сырые; MCP требует живого приложения; зрелость не доказана.
- OpenPencil CLI-линтер (детерминированный гейт без приложения) — не верифицирован на практике.
- Направление синка `@theme` ↔ DTCG (кто источник правды) не исследовано.

## Open questions (для продолжения в этой папке)

1. ~~**`/design` у Claude Code**~~ — **✅ закрыто (см. §1a)**: это Claude Design (`claude.ai/design`) + `/design-sync` + MCP; ассист, не барьер, не headless для генерации, на `api.anthropic.com`.
2. Что такое «Open Design» — реальный продукт или неточное имя. Нужны точные URL.
3. РФ-доступность Pencil.dev / OpenPencil / Chromatic / npm-плагинов без блокировок.
4. Двусторонний пайплайн Tailwind 4 `@theme` ↔ DTCG/Style Dictionary без дублирования источника правды.
5. Вендоринг `ui-ux-pro-max` в репо (пин версии, чтение инструкций/`.py`) и форма интеграции — гайд `ralph.md` vs дизайн-ревью субагент. Ценно скорее для #262, чем для pixel-tanks.

## Источники (primary)

- Pencil.dev: https://docs.pencil.dev/getting-started/ai-integration
- OpenPencil: https://github.com/open-pencil/open-pencil · https://openpencil.dev/programmable/mcp-server
- Style Dictionary / DTCG: https://styledictionary.com/info/dtcg/
- @poupe/eslint-plugin-tailwindcss: https://github.com/poupe-ui/eslint-plugin-tailwindcss
- francoismassart/eslint-plugin-tailwindcss: https://github.com/francoismassart/eslint-plugin-tailwindcss
- better-tailwindcss: https://github.com/schoero/eslint-plugin-better-tailwindcss
- Loki: https://github.com/oblador/loki · reg-suit: https://reg-viz.github.io/reg-suit/
- shadcn MCP: https://ui.shadcn.com/docs/mcp
- Claude Design / `/design-sync`: https://code.claude.com/docs/en/commands.md · https://support.claude.com/en/articles/14604416-get-started-with-claude-design

_Полный сырой вывод харнеса (25 фактов с цитатами/голосами) — в артефакте прогона `wy3jgj91o.output` (вне репо)._
