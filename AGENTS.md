# AGENTS.md

Инструкции для агентов, которые не читают `CLAUDE.md` и `.claude/rules/**` — не-Claude кодер-рантаймы автономного цикла ralph.

Например, **OpenAI Codex CLI** (`codex exec`) подхватывает файл `AGENTS.md` из корня репозитория автоматически. Решение зафиксировано в `docs/ralph-mini-framework/research.md`, раздел «Инструкции (AGENTS.md)».

**Источник правды по конвенциям — `CLAUDE.md`** (корень репозитория). Блоки ниже обёрнуты парой HTML-комментариев `AGENTS-SYNC:START`/`AGENTS-SYNC:END` с одинаковым ключом (открой файл в редакторе — маркеры видны прямо в разметке) и являются **дословной копией** одноимённых блоков из `CLAUDE.md`. Дрейф-проверка `scripts/agents-md-drift.mjs` (гейт: `npm run docs:agents-drift`) красит гейт мерджа, если содержимое блока с одним и тем же ключом разошлось между файлами. Правь конвенцию в `CLAUDE.md`, затем скопируй тот же блок сюда между теми же маркерами — по отдельности эти два файла не редактируются.

## Кто ты и откуда контракт петли

Кодер-сессия в автономном цикле ralph (issue → код → PR → ревью → гейт → мердж). Общий
контракт петли (как брать issue, ветки, TDD, circuit breaker, `blocked`/`hold`,
завершение сессии) **не дублируется в этом файле** — рантайм получает его тем же
способом, что и Claude: **текстом промпта сессии** (`.claude/ralph/ralph.md` +
`.claude/ralph/ralph.project.md`, см. решение в `docs/ralph-mini-framework/research.md`).
Этот файл несёт только **проектные конвенции кода**, которые Claude получает через
`CLAUDE.md` и `.claude/rules/**`.

## Язык общения

<!-- AGENTS-SYNC:START lang -->

- Всегда общайся на русском языке
- Комментарии к коду, коммиты, PR — на русском

<!-- AGENTS-SYNC:END lang -->

## Технологический стек

<!-- AGENTS-SYNC:START stack -->

**Основа:** Next.js 16 + React 19 + TypeScript 5 + Tailwind 4 + своя UI-библиотека `shared/ui` (игровая тема: шрифты **DotGothic16** (display) + **JetBrains Mono** (UI/HUD) + **Montserrat** (body-sans) + **Press Start 2P** (pixel-акценты), self-hosted из `public/fonts`; NES-рамки `pixel-border`; кастомная dark-палитра + faction-темы через `[data-faction]` — токены в `globals.css`, витрина `/design-system`).

**Данные:** TanStack Query (server state) + Zustand (client state) + React Hook Form + Zod (валидация).

**Backend (шаг 5):** Payload CMS 3, inline в Next.js. Адаптер БД — `@payloadcms/db-sqlite` (dev и prod; Postgres `@payloadcms/db-postgres` — опция на будущее, пакет пока не установлен). Оба адаптера **используют Drizzle под капотом** — для кастомных запросов `payload.db.drizzle`.

**Auth (шаг 7):** Payload local auth (email/password) + OAuth через **Яндекс ID** (шаг 9). **Google OAuth не используем** — по закону РФ (поправки к 149-ФЗ, с 01.12.2023) авторизация пользователей на российских сайтах допускается только через телефон, Госуслуги (ЕСИА) или российские сервисы (Яндекс ID, VK ID).

**Тесты:** Vitest + Testing Library + happy-dom (unit/component), Playwright (e2e).

**Линтинг:** ESLint 9 (flat config) + Steiger (FSD) + Prettier + Husky + lint-staged.

<!-- AGENTS-SYNC:END stack -->

## Архитектура: FSD 2.1 + App Router

```
src/
├── app/                 — Next.js App Router: маршрутизация, layout'ы, провайдеры
│   ├── (frontend)/      — Route-группа игры: layout (шрифты + QueryProvider), page.tsx, /design-system и др.
│   ├── (payload)/       — Route-группа Payload (админка/API)
│   └── globals.css      — Tailwind 4, игровая тема (@theme токены, pixel-border)
│
├── views/               — FSD-слой pages (переименован — конфликт с Next.js Pages Router)
│   └── main-page, game-page, design-system, replay-page/
│
├── widgets/             — Составные UI-блоки (game-controls, game-over-dialog, pause-overlay)
│
├── features/            — Бизнес-фичи (game-engine, daily-challenge, replays)
│
├── entities/            — Сущности (bot-messages, replays)
│
└── shared/              — Общее, не зависит от бизнеса
    ├── api/             — TanStack Query клиент, QueryProvider
    ├── config/          — APP_NAME, константы
    ├── ui/              — Переиспользуемые UI-компоненты
    ├── lib/             — Утилиты
    └── model/           — Бизнес-типы (TCoords, TWeapon)
```

### Правила FSD (ОБЯЗАТЕЛЬНО)

<!-- AGENTS-SYNC:START fsd-import-rules -->

- **Импорты только сверху вниз:** `app → views → widgets → features → entities → shared`
- **Нельзя** импортировать из соседнего слайса того же слоя. Для cross-entity связей — поднимать в features
- **Public API:** каждый слайс экспортирует через `index.ts`. Импорт из внутренних файлов запрещён
- **`app/`** — только маршрутизация и провайдеры. `page.tsx` — тонкая обёртка над `views/`
- **`src/pages/` запрещён** — Next.js считает его Pages Router. FSD-слой `pages` живёт в `src/views/`

<!-- AGENTS-SYNC:END fsd-import-rules -->

Steiger валидирует структуру автоматически: `npm run lint:fsd`.

## Конвенции кода

### Форматирование

<!-- AGENTS-SYNC:START formatting -->

- **Отступы:** 4 пробела (табы запрещены)
- **Никаких `any`** — `unknown`, дженерики, Zod-инференс. ESLint `@typescript-eslint/no-explicit-any: error`
- **React 19:** НЕ использовать `useMemo`, `useCallback`, `React.memo` — React Compiler делает это автоматически
- **Компоненты по умолчанию серверные.** `'use client'` только когда нужен клиентский JS (Canvas, useState, события)
- **`h-dvh` вместо `h-screen`** — учитывает dynamic viewport на мобилках
- **APP_NAME через константу** из `@/shared/config`, не хардкодить

<!-- AGENTS-SYNC:END formatting -->

### Нейминг файлов и папок

<!-- AGENTS-SYNC:START naming-files -->

Всё **kebab-case**. Точка-суффикс = назначение модуля. Префикс = тип сущности.

| Что                          | Паттерн                          | Пример                          |
| ---------------------------- | -------------------------------- | ------------------------------- |
| **Компонент (папка + файл)** | `kebab-case/kebab-case.tsx`      | `score-board/score-board.tsx`   |
| **Хук**                      | `use-kebab-case.ts`              | `use-game-tick.ts`              |
| **Утилита**                  | `kebab-case.ts`                  | `calculate-trajectory.ts`       |
| **API (TanStack Query)**     | `kebab-case.api.ts`              | `leaderboard.api.ts`            |
| **Zustand store**            | `kebab-case.store.ts`            | `game.store.ts`                 |
| **Тест**                     | `kebab-case.test.ts(x)`          | `calculate-trajectory.test.ts`  |
| **Тип**                      | `t-kebab-case.ts` → `type TName` | `t-player.ts` → `TPlayer`       |
| **Enum**                     | `e-kebab-case.ts` → `enum EName` | `e-game-mode.ts` → `EGameMode`  |
| **Public API**               | `index.ts`                       | Обязательно в каждом FSD-слайсе |

<!-- AGENTS-SYNC:END naming-files -->

### Нейминг сущностей в коде

<!-- AGENTS-SYNC:START naming-entities -->

| Сущность                 | Правило                              | Пример              |
| ------------------------ | ------------------------------------ | ------------------- |
| **Тип**                  | `type` (не `interface`), префикс `T` | `type TGameState`   |
| **Enum**                 | префикс `E`                          | `enum EGameMode`    |
| **Хук**                  | префикс `use`                        | `useGameTick()`     |
| **Компонент**            | PascalCase                           | `ScoreBoard`        |
| **Переменная / функция** | camelCase                            | `calculateImpact()` |
| **Константа**            | UPPER_SNAKE_CASE                     | `MAX_WIND_SPEED`    |

<!-- AGENTS-SYNC:END naming-entities -->

### Тесты

<!-- AGENTS-SYNC:START tests -->

- Каждый новый модуль — сопровождается тестом рядом (`game.store.ts` → `game.store.test.ts`)
- Утилиты, хелперы, хуки — unit-тесты обязательны
- Игровая физика (траектория, столкновения, ветер) — детерминированные unit-тесты с фиксированными входами
- Zod-схемы — тесты на валидные и невалидные данные

<!-- AGENTS-SYNC:END tests -->

Подробнее — `.claude/rules/tests.md`: тестируй поведение, а не реализацию; структура
Arrange → Act → Assert; названия описывают сценарий; обязательны негативные сценарии.

### Коммиты (Conventional Commits)

<!-- AGENTS-SYNC:START git-commits -->

Формат: `тип: описание на русском`

| Тип         | Когда                               |
| ----------- | ----------------------------------- |
| `feat:`     | Новая функциональность              |
| `fix:`      | Исправление бага                    |
| `refactor:` | Рефакторинг без изменения поведения |
| `chore:`    | Конфиги, зависимости, скрипты       |
| `docs:`     | Документация                        |
| `test:`     | Тесты                               |
| `perf:`     | Оптимизация производительности      |

### Автозакрытие issues

Ключевые слова в описании PR — **только английские**: `Closes #N`, `Fixes #N`, `Resolves #N`. Русское «Закрывает #N» GitHub не распознаёт: PR смерджится, а issue останется висеть открытым. Сам текст PR при этом на русском.

<!-- AGENTS-SYNC:END git-commits -->

## Что ещё почитать по теме файла, который правишь

Правила по глобам (`.claude/rules/`, не дублируются здесь — грузи целиком при правке
совпадающих путей):

- `.claude/rules/canvas.md` — игровой цикл/физика, при правках `src/features/game-engine/**`, `src/shared/lib/canvas/**`.
- `.claude/rules/payload.md` — Payload CMS Local API/access/hooks, при правках `src/payload/**`, `src/app/(payload)/**`.
- `.claude/rules/design-system-showcase.md` — витрина `/design-system`, при правках `src/shared/ui/**`, `src/views/design-system/**`.
- `.claude/rules/tests.md` — правила тестов (см. выше).
