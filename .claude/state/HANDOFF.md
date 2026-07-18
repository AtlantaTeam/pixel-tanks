# Session Handoff

**Дата**: 2026-07-18

## Текущая задача

Фаза 1 game-next завершена, **PR #39 всё ещё ждёт `/code-review`** (отложен из-за квоты). В этой сессии: роутинг моделей Ralph по сложности, README (дипломный проект + починен ASCII-арт), защита main.

## Последние принятые решения

- **Роутинг моделей Ralph**: issue помечается label `complexity:{low|medium|high|expert}` → haiku/sonnet/opus/fable (`ralph.config.json → modelRouting`). Все 33 открытых issues размечены. Ревью фазы: **opus по умолчанию**, эскалация на **fable**, если в фазе есть `complexity:expert` (`review.escalateOn`). Fable-ревью получат фазы 3 (тач-рогатка) и 9 (реплеи).
- **Скилл `issues`** теперь обязан проставлять label сложности при создании issue (таблица критериев — в SKILL.md) — договорённость с Димой: labels автоматом при загрузке бэклога.
- **main защищён**: только через PR, enforce_admins=true, force-push/удаление запрещены, approvals = 0 (чтобы не блокировать автономный мердж). Прямой push в main теперь отклонится — не пытаться.
- README: «дипломный проект» (не «курсовая»); ASCII-арт перерисован только из monospace-безопасных символов (█ ▄ ▀ ═ o) — глифы ◎ ▲ ▬ ▂ и эмодзи ломали выравнивание на GitHub. Проверено Playwright-скриншотом блока.

## Следующие шаги

1. `/code-review` по PR #39 (diff: `src/shared/lib/random/`, wind.ts, движок, 4 тест-файла)
2. Чистое ревью → смоук `/game?seed=42` (дважды — идентичный террейн) → мердж PR (не squash) → issues #1–4 закроются
3. После мерджа: в `ralph.config.json` phases → Фаза 2 (`milestone: "Фаза 2: Мобильный layout"`, `branch: "feature/phase-2-mobile"`), `node .claude/ralph/ralph.js --reset`, запуск `--once` (HITL)
4. При <20% окна квоты раннер не запускать

## Open questions

- Мелочи вне скоупа: favicon 404, unused `setPower`, ESLint-ошибки в `.claude/hooks/*.js`
- Кто из команды подключается к AtlantaTeam-репо (права, ревью, распределение issues)
- OPENAI_API_KEY для генерации артов — Дима положит в `.env.local` по запросу
