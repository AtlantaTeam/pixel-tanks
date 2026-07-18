# Session Handoff

> Обновляется автоматически перед закрытием сессии. Перезаписывается целиком, максимум 50 строк.

**Дата**: 2026-07-18

## Текущая задача

game-ui завершена (см. `docs/game-ui/prd.md`). Следующая — фаза 6 (auth) по методологии `/prd` → `/plan-phase` → `/research`.

## Последние принятые решения

- **`web/` — отдельный git-репо `Pelmenya/pocket-tanks-next` (private)**, вложен в старый репо курсовой. Коммиты здесь разрешены; `../` (старый репо) не трогать. По завершении — push в общий репо вторым remote.
- DaisyUI удалён → `shared/ui` (Button/Panel/Select/Dialog), тема Pico-8, Press Start 2P (кириллица работает), NES-рамки `pixel-border`.
- Грабли решённые: шрифтовые токены от next/font — только в `@theme inline`; цвет pixel-border — через `--pixel-border-color` (currentColor невидим у primary на тёмном фоне).
- Скрины Playwright — только в `screenshots/` (gitignored).
- Сессии Claude открывать в `web/` (здесь .claude, хуки, git). Копия .claude в `../` — устаревшая, можно удалить.

## Следующие шаги

1. `/prd auth` → фаза 6: Payload local auth (регистрация/логин)
2. favicon добавить (404 в консоли)
3. Тестов нет вообще (`npm run test` падает «no test files») — писать с фазы 6, физику покрыть ретроактивно
4. Незакрытое: unused `setPower` в game-canvas.tsx (warning)

## Open questions

- Когда переносить в общий командный репо (после какой фазы)
- Тесты физики: сразу отдельной задачей или вместе с фазой 6
