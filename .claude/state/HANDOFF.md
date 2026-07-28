# Session Handoff

**Дата**: 2026-07-28

## Текущая задача

Очередь раннера снова **пуста**: фаза #48 «Баг-фиксы ДС · Select + вход на витрину»
смерджена (PR #355) и задеплоена (прод 200, sha `2a39d69`). Раннер завершился штатно,
state снова `milestone:null`. Прод в порядке.

## Последние принятые решения

- **Скилл `ui-ux-pro-max` унифицирован** (PR #356): перенесён в обычную папку
  `.claude/skills/ui-ux-pro-max/` как остальные 13 скиллов; `.agents/` + симлинк +
  `skills-lock.json` удалены. Держим в репо вручную, не через инсталлер-lock. См.
  память `ui-ux-skill-in-project-not-global`.
- **Select (#350) сделан рукописным, не headless.** Обсуждали headless (Radix/Ark/
  React Aria): селект в любом случае клиентский остров (`'use client'`), RSC его не спасает;
  за рукописный играет бандл (ноль лишнего client-JS поверх Canvas). Headless — запасной
  трек, если a11y-ревью покажет дыры; тогда точечный SSR-чистый примитив + наши токены,
  `id` через `useId` (иначе hydration-mismatch).
- **Витрина = мини-сторибук на проде** (`pixeltanks.ru/design-system`), README ссылается
  на прод-URL. Память `design-system-showcase-hosted-on-prod`.
- Докдрейф вычищен (PR #353): `Pixelify Sans → DotGothic16`, + Montserrat/Press Start 2P,
  `pause-overlay`, `TCoords/TWeapon`, БД-адаптер. Хвост `.pyc` из #344 закрыт (PR #352).

## Следующие шаги

1. (Опц.) Playwright-smoke нового Select на `/design-system`: реально ли открывается попап +
   клавиатура — исходная жалоба, её diff-ревью петли структурно не проверяет. Формальное
   ре-ревью НЕ нужно (ревью петли прошло, blocker снят).
2. По результату smoke — оставить рукописный или завести follow-up на headless.
3. Барьер #346 (детерминированно верифицировать вызов скилла) — с человеком, трогает гейт.

## Open questions

- #355 review-loop дал **31 находку** (1 blocker снят, 3 major, 9 minor, 13 nit). Majors
  гейт не блочит — могли уехать неразобранными. Разобрать по журналу
  (`.claude/ralph/review-findings.jsonl`) / `record-found-after.mjs`?
- Заводить follow-up на headless-Select сейчас или ждать вердикта smoke?
