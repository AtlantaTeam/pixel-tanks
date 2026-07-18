# CLAUDE.md

Инструкции для Claude Code при работе с этим репозиторием.

## Текущая задача

### Rewrite Pocket Tanks на современный стек

| Шаг                  | Описание                                                                                                              | Прогресс |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| 1. Каркас            | Next 16 + React 19 + TS + Tailwind 4 + FSD + Steiger                                                                  | ✅ done  |
| 2. Конвенции         | ESLint flat config, Prettier, vitest, субагенты                                                                       | ✅ done  |
| 3. Базовая страница  | `app/layout.tsx` + `views/main-page` + QueryProvider                                                                  | ✅ done  |
| 4. Перенос игры      | Canvas-логика из старого `src/components/Pages/Game/` в `features/game-engine`                                        | ✅ done  |
| 5. Payload CMS       | Inline-интеграция Payload 3, SQLite-адаптер, коллекции users + scores                                                 | ✅ done  |
| 6. Game-next         | Мобилка (тач) + клавиатура, juice, оригинальный звук, бот-реплики, daily challenge + реплеи — `docs/game-next/prd.md` | ⬜ 0%    |
| 7. Auth + профиль    | Регистрация / логин через Payload local auth, страница профиля                                                        | ⬜ 0%    |
| 8. Лидерборд         | `views/leaderboard` + TanStack Query + Payload REST                                                                   | ⬜ 0%    |
| 9. OAuth (Яндекс ID) | Payload OAuth-стратегия, авторизация через Яндекс ID                                                                  | ⬜ 0%    |
| 10. i18n             | `next-intl`, обернуть все строки в `t('...')`                                                                         | ⬜ 0%    |

**Старый код** — в `../pocket-tanks/` (соседняя папка на Desktop). Это референс при портировании, не трогать на запись.

## Язык общения

- Всегда общайся на русском языке
- Комментарии к коду, коммиты, PR — на русском

## Обзор проекта

**Pocket Tanks** — учебная игра в жанре «танковая дуэль» на Canvas. Два танка по углу, силе и ветру стреляют друг в друга. Старая курсовая Яндекс.Практикума (команда «Atlanta Team», 2021), переписывается на современный стек.

**Что переносим:** игру, регистрацию/логин, профиль, лидерборд.
**Что выкидываем:** Redux + redux-saga, Webpack, connected-react-router, Formik+Yup, Sequelize+Express, Storybook, страницы Forum и Privacy. OAuth Яндекс — возвращаем в фазе 9. Аудио из `static/audio/` (мелодии Андрея) — возвращаем в фазе 6 (game-next).

## Технологический стек

**Основа:** Next.js 16 + React 19 + TypeScript 5 + Tailwind 4 + своя UI-библиотека `shared/ui` (игровая тема: шрифт Press Start 2P, NES-рамки `pixel-border`, палитра Pico-8 — токены в `globals.css`).

**Данные:** TanStack Query (server state) + Zustand (client state) + React Hook Form + Zod (валидация).

**Backend (фаза 5+):** Payload CMS 3, inline в Next.js. Адаптер БД — `@payloadcms/db-sqlite` (dev) или `@payloadcms/db-postgres` (prod). Оба адаптера **используют Drizzle под капотом** — для кастомных запросов `payload.db.drizzle`.

**Auth (фаза 6+):** Payload local auth (email/password) + OAuth через **Яндекс ID** (фаза 8). **Google OAuth не используем** — по закону РФ (поправки к 149-ФЗ, с 01.12.2023) авторизация пользователей на российских сайтах допускается только через телефон, Госуслуги (ЕСИА) или российские сервисы (Яндекс ID, VK ID).

**Тесты:** Vitest + Testing Library + happy-dom (unit/component), Playwright (e2e).

**Линтинг:** ESLint 9 (flat config) + Steiger (FSD) + Prettier + Husky + lint-staged.

## Архитектура: FSD 2.1 + App Router

```
src/
├── app/                 — Next.js App Router: маршрутизация, layout'ы, провайдеры
│   ├── layout.tsx       — Root layout, QueryProvider, Montserrat
│   ├── page.tsx         — Главная (тонкая обёртка → views/main-page)
│   └── globals.css      — Tailwind 4, игровая тема (@theme токены, pixel-border)
│
├── views/               — FSD-слой pages (переименован — конфликт с Next.js Pages Router)
│   └── main-page/
│
├── widgets/             — Составные UI-блоки (header, score-board)
│
├── features/            — Бизнес-фичи (game-engine, leaderboard-submit, auth-form)
│
├── entities/            — Сущности (game, player, score)
│
└── shared/              — Общее, не зависит от бизнеса
    ├── api/             — TanStack Query клиент, QueryProvider
    ├── config/          — APP_NAME, константы
    ├── ui/              — Переиспользуемые UI-компоненты
    ├── lib/             — Утилиты
    └── model/           — Бизнес-типы (TPlayer, TScore)
```

### Правила FSD (ОБЯЗАТЕЛЬНО)

- **Импорты только сверху вниз:** `app → views → widgets → features → entities → shared`
- **Нельзя** импортировать из соседнего слайса того же слоя. Для cross-entity связей — поднимать в features
- **Public API:** каждый слайс экспортирует через `index.ts`. Импорт из внутренних файлов запрещён
- **`app/`** — только маршрутизация и провайдеры. `page.tsx` — тонкая обёртка над `views/`
- **`src/pages/` запрещён** — Next.js считает его Pages Router. FSD-слой `pages` живёт в `src/views/`

Steiger валидирует структуру автоматически: `npm run lint:fsd`.

## Конвенции кода

### Форматирование

- **Отступы:** 4 пробела (табы запрещены)
- **Никаких `any`** — `unknown`, дженерики, Zod-инференс. ESLint `@typescript-eslint/no-explicit-any: error`
- **React 19:** НЕ использовать `useMemo`, `useCallback`, `React.memo` — React Compiler делает это автоматически
- **Компоненты по умолчанию серверные.** `'use client'` только когда нужен клиентский JS (Canvas, useState, события)
- **`h-dvh` вместо `h-screen`** — учитывает dynamic viewport на мобилках
- **APP_NAME через константу** из `@/shared/config`, не хардкодить

### Нейминг файлов и папок

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

### Нейминг сущностей в коде

| Сущность                 | Правило                              | Пример              |
| ------------------------ | ------------------------------------ | ------------------- |
| **Тип**                  | `type` (не `interface`), префикс `T` | `type TGameState`   |
| **Enum**                 | префикс `E`                          | `enum EGameMode`    |
| **Хук**                  | префикс `use`                        | `useGameTick()`     |
| **Компонент**            | PascalCase                           | `ScoreBoard`        |
| **Переменная / функция** | camelCase                            | `calculateImpact()` |
| **Константа**            | UPPER_SNAKE_CASE                     | `MAX_WIND_SPEED`    |

### Тесты

- Каждый новый модуль — сопровождается тестом рядом (`game.store.ts` → `game.store.test.ts`)
- Утилиты, хелперы, хуки — unit-тесты обязательны
- Игровая физика (траектория, столкновения, ветер) — детерминированные unit-тесты с фиксированными входами
- Zod-схемы — тесты на валидные и невалидные данные

### Git

Этот каталог — **самостоятельный git-репозиторий**, origin — командный **`AtlantaTeam/pocket-tanks-next`**. Коммиты здесь разрешены и приветствуются. Старый репо курсовой — соседняя папка `../pocket-tanks/` — НЕ трогать: ни файлы, ни git. Бэклог — milestones/issues репо + доска [AtlantaTeam/projects/1](https://github.com/orgs/AtlantaTeam/projects/1); новые issues обязательно добавлять на доску (скилл `issues` делает это сам).

### Коммиты (Conventional Commits)

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

## Линтинг

| Пакет                        | Зачем                                         |
| ---------------------------- | --------------------------------------------- |
| **ESLint** 9.x (flat config) | Линтинг + правило `no-explicit-any: error`    |
| **Steiger** 0.x              | FSD-линтер — структура, импорты, public API   |
| **Prettier**                 | Форматирование                                |
| **Husky** + **lint-staged**  | Pre-commit: Prettier → ESLint → Steiger → tsc |

## Скрипты

```bash
npm run dev          # next dev на порту 3050
npm run build        # next build
npm run start        # next start (production)
npm run lint         # ESLint
npm run lint:fsd     # Steiger (FSD-валидация)
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run test:watch   # vitest watch
npm run test:coverage
```

## Playwright MCP — обязателен для UI-разработки

Для проверки любых UI-изменений (новые страницы, компоненты, баги вёрстки, адаптив, тёмная тема) использовать **Playwright MCP** — не просить у пользователя скриншот, не «допускать что работает».

**Скриншоты — только в папку `screenshots/`** (в `.gitignore`): в `browser_take_screenshot` всегда передавать `filename: "screenshots/<имя>.png"`, не класть скрины в корень проекта. Чистка — удаление одной папки.

Стандартный цикл:

1. Запустить dev (`npm run dev`)
2. `mcp__playwright__browser_navigate` на `http://localhost:3050`
3. `mcp__playwright__browser_snapshot` или `browser_take_screenshot`
4. `mcp__playwright__browser_console_messages` для проверки ошибок
5. Итерировать

## Субагенты

В `.claude/agents/`:

| Агент                    | Когда использовать                                             | subagent_type          |
| ------------------------ | -------------------------------------------------------------- | ---------------------- |
| **architect-reviewer**   | Архитектурные решения: FSD, паттерны, слои, зависимости        | `architect-reviewer`   |
| **test-automator**       | Генерация тестов, покрытие, стратегия тестирования             | `test-automator`       |
| **performance-engineer** | Оптимизация: бандл, рендер, Canvas FPS, SSR/ISR                | `performance-engineer` |
| **frontend-developer**   | React 19 + Next 16 + Tailwind 4 + FSD — реализация UI и Canvas | `frontend-developer`   |
| **docs-reviewer**        | Дрейф документации: CLAUDE.md vs package.json/код vs git log   | `docs-reviewer`        |

Все агенты используют модель `opus`.

Ревью кода — встроенный `/code-review` (не кастомный агент): верификация находок, уровни глубины, ultra-режим.

## Старый код проекта

Старый код лежит в соседней папке `../pocket-tanks/` (Desktop). Структура:

```
../pocket-tanks/
├── src/                    — Старый React 17 + Webpack + Sequelize код (РЕФЕРЕНС, не трогать)
│   ├── components/Pages/Game/   — Старая Canvas-игра. Логика, спрайты, физика
│   ├── modules/                 — bot-messages, http-service, notifications
│   └── ...
├── static/                  — Шрифты, иконки, фоны игры (можно копировать в public/)
└── stage/                   — Старый docker-compose (Postgres) — не используем
```

При портировании — изучать `../pocket-tanks/src/components/Pages/Game/` и переносить логику в `src/features/game-engine/` или `src/entities/game/`. Папка только для чтения, пользователь чистит её сам.

## Этапы реализации

- **Этап 1:** Каркас ✅, базовая страница ✅
- **Этап 2:** Перенос Canvas-игры (физика, рендер, управление) — без сервера
- **Этап 3:** Payload CMS + SQLite + коллекции users/scores
- **Этап 4:** Auth (регистрация/логин)
- **Этап 5:** Лидерборд с отправкой результатов
- **Этап 6:** OAuth Яндекс ID, темы, polish
- **Этап 7:** i18n через `next-intl` (RU + EN), обернуть все строки в `t('...')`. Добавляем перед мерджем фазы 3 — раньше нет смысла, текстов мало
