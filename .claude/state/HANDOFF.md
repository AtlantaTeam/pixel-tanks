# Session Handoff

**Дата**: 2026-07-19

## Текущая задача

**GAME-NEXT ЗАВЕРШЁН ЦЕЛИКОМ**: все 9 фаз смерджены, milestones закрыты, loop
финишировал штатно («Все фазы завершены», `milestone: null` в state, рестарт
идемпотентен). Открытых PR/blocked нет. Единственный открытый issue — #53
(деградация juice, осознанный бэклог вне milestone). Следующий этап — финальный
`/code-review ultra` на main (Дима запускает сам в новой сессии, лимиты).

## Последние принятые решения

- **Полная автономность loop** (PR #58, #59, #61): self-heal красного гейта и
  blocked-label → чини-сессия → повторное ревью → гейт (лимиты попыток в state);
  merge-retry со сверкой phaseMerged; auto-wait 5-часового лимита; husky
  (pre-commit lint-staged+fsd+tsc, pre-push build+test); ревью маркирует
  severity 🔴🟠🟡⚪ обязательно; fix-шаг резолвит ревью-треды (в PR #60 висели все 16).
- **Прод-режим ralph**: после ultra — пишем PRD вместе (prd → plan-phase →
  research → issues), работа ТОЛЬКО Дима+Fable вручную в консоли, не loop.
  Заготовки в memory: project_ralph_prod_prd_seeds, project_ralph_growth_vectors.
- Blocked в прод-профиле вернётся человеку (blockedHealAttempts=0) — здесь
  учебный полигон, там нет.
- README: hero-арт (docs/images/pixel-tanks-hero.png), PR #55.

## Следующие шаги

1. `/code-review ultra` на main (Дима, новая сессия) → блокеры чинить, мелочь → issues.
2. PRD «прод-режим ralph» вместе с Димой (см. memory-заготовки).
3. Фазы 7-10 корневого плана (auth, лидерборд, Яндекс ID, i18n): новый конфиг
   phases + issues через скилл issues — вторая обкатка автономного loop.
4. Бэклог: #53 (device-tier частицы); доска — включить workflow «Item closed → Done»
   в UI (API не умеет; #13-15 двигал руками).

## Open questions

- Недельный лимит подписки: сброс 20.07 17:59 МСК (Fable был на 69% в середине дня).
- CLAUDE.md дрейф: husky теперь есть (докам нужен docs-reviewer прогон).
