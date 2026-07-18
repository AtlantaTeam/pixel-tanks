# Session Handoff

> Обновляется автоматически перед закрытием сессии. Перезаписывается целиком, максимум 50 строк.

**Дата**: 2026-07-18

## ⚡ ПЕРВЫМ ДЕЛОМ в этой сессии (переезд папки)

Папка проекта переехала: `pocket-tanks/web` → `Desktop\pocket-tanks-next` (перенёс пользователь вручную, VS Code блокировал автоперенос). Сделать по порядку:

1. Проверить: cwd = `...\pocket-tanks-next`, `git remote -v` → `Pelmenya/pocket-tanks-next`, `git status` чистый
2. CLAUDE.md: поправить пути и формулировки — старый код теперь в `../pocket-tanks/src/` (был `../src/`); раздел Git: репо больше НЕ вложен в старый, это самостоятельная папка. Секцию «Старый код проекта» переписать под новую схему расположения
3. Память Claude: скопировать все файлы из
   `C:\Users\Diamond\.claude\projects\C--Users-Diamond-Desktop-pocket-tanks\memory\`
   в memory-каталог нового проекта (путь с `...-pocket-tanks-next`), в скопированном поправить устаревшие пути/факты
4. Смоук после переноса: `npm run dev` (порт 3050) → главная и /game открываются, скрин в `screenshots/`
5. Закоммитить правки CLAUDE.md (`docs:`) и запушить
6. Старая папка `pocket-tanks` — референс, только чтение; пользователь чистит её сам

## Контекст проекта

- Rewrite Pocket Tanks: фазы 1–5 done (каркас, игра на Canvas, Payload+SQLite), game-ui done (`docs/game-ui/prd.md`)
- `shared/ui`: Button/Panel/Select/Dialog, тема Pico-8, Press Start 2P, NES-рамки. Грабли: шрифты next/font — только `@theme inline`; цвет рамки — `--pixel-border-color`
- Скрины Playwright — только в `screenshots/` (gitignored)
- Тестов нет вообще — `npm run test` падает «no test files» (долг фаз 1–5)

## Следующие шаги (после переезда)

1. `/prd auth` → фаза 6: Payload local auth (регистрация/логин)
2. favicon (404 в консоли); unused `setPower` в game-canvas.tsx
3. Тесты физики — решить: отдельной задачей или в фазе 6
4. Codex CLI (`codex exec`, read-only) — дешёвое второе мнение; арты — пользователь генерит в ChatGPT UI

## Open questions

- Когда переносить в общий командный репо
