# Session Handoff

**Дата**: 2026-07-18

## Текущая задача

**Фаза 1 смерджена в main (PR #39)** после code review (opus-агент) + фикса ветра + смоука. Ветка `feature/phase-2-mobile` создана, конфиг Ralph переключён на Фазу 2, счётчики сброшены. **Раннер НЕ запущен** — решение по квоте за Димой: `node .claude/ralph/ralph.js --once` (HITL).

## Последние принятые решения

- **Ревью PR #39 (opus, один агент по просьбе Димы)** нашло major: ветер `dx -= dx*wind` был затуханием, а не силой. Исправлено на `dx += wind` (постоянное боковое ускорение, px/тик²) + тесты на знак/симметрию/вертикальный выстрел. 32/32 зелёные.
- Смоук-протокол детерминизма: hash canvas.toDataURL через Playwright — `seed=42` дважды идентичен, `seed=99` отличается.
- **Роутинг моделей Ralph**: label `complexity:{low|medium|high|expert}` → haiku/sonnet/opus/fable; ревью фазы opus, эскалация на fable при `complexity:expert` (фазы 3 и 9). Скилл `issues` проставляет labels при создании.
- **main защищён**: только через PR, enforce_admins=true → прямой push отклонится, даже для правки конфига — любые изменения через ветку+PR.
- README: «дипломный проект», ASCII-арт из monospace-безопасных символов (◎ ▲ ▬ ▂ и эмодзи ломали выравнивание на GitHub).
- `.claude/**` исключён из ESLint (Node-скрипты хуков/Ralph с require).

## Следующие шаги

1. Запуск Ralph по Фазе 2 (`--once`, HITL): issues #5–#8, модели по labels (sonnet ×3, opus #7)
2. Известный minor из ревью: смена seed при client-side навигации игнорируется (`game-canvas.tsx` deps `[]`) — починить в одной из мобильных фаз
3. После issues фазы: раннер сам создаст PR + ревью (opus)

## Open questions

- Мелочи: favicon 404, unused `setPower` в game-canvas.tsx
- Кто из команды подключается к AtlantaTeam-репо (права, ревью, распределение issues)
- OPENAI_API_KEY для генерации артов — Дима положит в `.env.local` по запросу
