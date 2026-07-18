# Session Handoff

**Дата**: 2026-07-18 (вечер)

## Текущая задача

Game-next AFK через ralph loop. **Фаза 5 «Оригинальный звук» смерджена** (PR #50,
milestone #5 закрыт). Идёт **Фаза 6 «Juice-пакет»** — на момент паузы 2/7 закрыто
(#21 пул частиц, #22), активный issue #23 (след пули). Дима устал → пауза, рестарт завтра.

## Состояние на сейчас

- `ralph.state.json` = `{count:3, milestone:"Фаза 6: Juice-пакет", submitted:false}` — персистентный,
  рестарт продолжит Фазу 6 с открытых issues.
- Фоновый `node ralph.js` при закрытии терминала прервётся посреди #23 → **дерево останется
  грязным** (bullet-trail.ts/.test.ts, shared/lib/animation/, M game-play.ts, M game-controls.tsx).
- Наблюдающий heartbeat-loop остановлен.

## Готово, но НЕ применено (ждёт завтра)

Улучшение ralph по просьбе Димы «чинить всё вплоть до мелких»:

- Патч промптов ревью/правок: `.claude/ralph/pending-review-improvements.patch` (durable, в git-exclude).
  Ревьюер маркирует severity [blocker/major/minor/nit] и выдаёт мелочи; fix-шаг чинит КАЖДЫЙ
  комментарий (пропуск — только с обоснованием в PR).
- ЕЩЁ не написано: авто-закрытие milestone сразу после мерджа фазы (сейчас `closeCompletedMilestones()`
  зовётся только на старте раннера, ~стр 560 → milestone Фазы висит open до следующего рестарта).

## Чеклист рестарта (завтра, по порядку)

1. `git status` — если грязно от прерванного #23: `git checkout -- .` + удалить untracked
   (`bullet-trail.*`, `src/shared/lib/animation/`). Issue #23 останется открыт — loop переделает.
2. `git apply .claude/ralph/pending-review-improvements.patch` → проверить `node --check .claude/ralph/ralph.js`.
3. Дописать в `ralph.js` фикс милстоуна: после `gate==='merged'` (~стр 805) закрывать milestone фазы
   через `gh api -X PATCH .../milestones/{n} -f state=closed`.
4. Закоммитить ralph.js в текущую ветку `feature/phase-6-juice` (уедет в PR Фазы 6) — дерево чистое.
5. `node .claude/ralph/ralph.js` (фон) → продолжит Фазу 6 уже с улучшенным ревью.
6. Мониторинг: `node .claude/ralph/monitor.js` (обновление 5 мин; в git-exclude, коммитить не нужно).

## Open questions

- C3 (public-репо + bypassPermissions на AFK) — прикрыт allowlist=[Pelmenya], операционный слой за Димой.
- OPENAI_API_KEY для артов (если Фаза 6/juice потребует генерации) — Дима в .env.local по запросу.
