# PRD: game-ui — своя UI-библиотека вместо DaisyUI

> ⚠️ **Устарело в части темы — вытеснено `docs/design-system-theming/`** (PR #296). Палитра Pico-8 и «Press Start 2P + Montserrat» ниже **НЕ актуальны**: текущая тема — неон hero-арта, **Pixelify Sans + JetBrains Mono**, токены в `globals.css` (витрина `/design-system`). Актуально и сейчас — только само решение отказаться от DaisyUI в пользу своей `shared/ui`. Файл сохранён как история.

**Дата**: 2026-07-18 · **Статус**: superseded (тема) / решение про свою UI-либу — в силе

## Проблема

DaisyUI — кит для «обычных сайтов», его темы не дают игровой стилистики и тянут зависимость ради 4 кнопок и 1 карточки. Игре нужен аркадный вид: пиксельный шрифт, NES-рамки, тёмная палитра.

## Решение

Мини-библиотека в `shared/ui` на Tailwind 4, без зависимостей:

- **Button** — варианты primary/ghost/danger, размеры sm/md/icon; NES-рамка, «нажатие» (сдвиг вниз)
- **Panel** — контейнер с pixel-рамкой (диалоги, HUD-блоки)
- **Select** — стилизованный нативный select (выбор оружия)
- **Dialog** — оверлей + Panel (game-over)

**Тема** (Pico-8 палитра): фон `#1a1c2c`, панель `#29366f`, primary `#ffcd75`, accent `#38b764`, danger `#b13e53`, текст `#f4f4f4`, muted `#94b0c2`.

**Шрифты**: Press Start 2P (заголовки, кнопки, HUD-цифры; поддерживает кириллицу) + Montserrat (текст).

**NES-рамка**: утилита `pixel-border` — 4 box-shadow по сторонам, углы «выгрызены» = пиксельный вид. Цвет — `currentColor`.

## Объём

1. `shared/ui/{button,panel,select,dialog}` + public API `shared/ui/index.ts`
2. Тема в `globals.css` (`@theme` токены), удаление `@plugin 'daisyui'`
3. Press Start 2P в layout через `next/font`
4. Миграция: `main-page`, `game-controls`, `game-over-dialog`
5. `npm uninstall daisyui`, чистка `CLAUDE.md`

## Критерии приёмки

- `lint`, `lint:fsd`, `typecheck`, `test` зелёные; daisy-классов в коде нет
- Playwright: главная и `/game` в новой теме, консоль чистая, адаптив 390px не разваливается
