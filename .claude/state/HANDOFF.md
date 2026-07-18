# Session Handoff

**Дата**: 2026-07-18

## Текущая задача

Ralph Loop, Фаза 1 («Детерминированная физика + seed»), ветка `feature/phase-1-seed`. **Issue #1 закрыт** (коммит `2d0bda9`), конвейер работает: реализация → тесты → коммит → закрытие issue → карточка в Done. Осталось: #2 (seed из URL), #3 (тесты физики), #4 (тесты террейна).

## ⚡ ПЕРВЫМ ДЕЛОМ в новой сессии (Ralph умер вместе со старой сессией)

1. Проверить хвост `.claude/ralph/ralph.log` и `gh issue list --milestone "Фаза 1: Детерминированная физика + seed" --state open`
2. Если рабочее дерево грязное (HANDOFF.md и пр.) — закоммитить в ветку фазы (`chore:`), иначе preflight раннера упадёт
3. Перезапустить: `node .claude/ralph/ralph.js` в фоне + монитор на `tail -f .claude/ralph/ralph.log`
4. Счётчик итераций: сгорело 5/10 (4 — об permission-блок, устранён). Если сработает circuit breaker — перезапуск продолжит с места остановки

## Последние принятые решения

- Ralph: кодер `claude-fable-5`, fallback sonnet-5, ревью PR — за супервизором (`reviewModel: none`), запуск НЕ трогать при живом раннере
- Permission-блок устранён: `git add/commit/push` в `allow` проектного settings.json (коммит `ec5c87d` в ветке фазы)
- Seeded-random: mulberry32 в `src/shared/lib/random/`, инжектируется в ground/wind/bullet/game-play; проп `seed` в GameCanvas — задел под #2
- По завершении фазы раннер сам создаёт PR → супервизор: /code-review, тесты, смоук, доклад Диме перед мерджем

## Open questions

- Мелочи вне скоупа: favicon 404, unused `setPower`, ESLint-ошибки в `.claude/hooks/*.js`
