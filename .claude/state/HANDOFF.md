# Session Handoff

**Дата**: 2026-07-18

## Текущая задача

Ralph, Фаза 1 («Детерминированная физика + seed»). **Issue #1 закрыт** — коммит `2d0bda9` в `feature/phase-1-seed`. Блокер коммитов снят: Дима перенёс `git add`/`git commit`/`git push` в `allow`.

## Последние принятые решения

- Seeded-random: mulberry32 в `src/shared/lib/random/`, инжектируется как `TRandomFn` в ground/wind/bullet/game-play.
- Проп `seed` в `GameCanvas` уже заведён — задел под Issue #2.
- Автономный цикл рабочий: коммит + закрытие Issue прошли без permission-блоков.

## Следующие шаги

1. Issue #2: seed из URL `/game?seed=...` — прокинуть searchParam в `GameCanvas`.
2. Issue #3: детерминированные unit-тесты физики (траектория, столкновения).
3. Issue #4: unit-тесты генерации террейна (частично покрыто в `ground.test.ts` — сверить с критериями Issue).
4. После закрытия всех issues фазы — PR делает раннер, не сессия.

## Open questions

- Известные мелочи вне скоупа фазы: favicon 404, unused `setPower`, ESLint-ошибки в `.claude/hooks/*.js`.
