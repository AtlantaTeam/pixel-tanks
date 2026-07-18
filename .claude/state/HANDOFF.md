# Session Handoff

**Дата**: 2026-07-18

## Текущая задача

Ralph-цикл по Фазе 2 (мобильный layout) завершён. Issue #8 (Playwright-проверка вьюпортов
375×667/667×375) закрыт и запушен в `feature/phase-2-mobile` (коммит cd8b0d7). Milestone
«Фаза 2: Мобильный layout» пуст — открытых issues больше нет.

## Последние принятые решения

- Добавлен `playwright.config.ts` (chromium, webServer на 3050, `reuseExistingServer` вне CI)
  и `e2e/mobile-viewport.spec.ts` — первый e2e-тест в проекте, `npm run test:e2e`.
- В `game-page.tsx` добавлен `data-testid="game-hud"` на контейнер HUD — стабильный селектор
  для e2e (единственное изменение прод-кода в этом issue).
- Неочевидный момент окружения: в этой машине выставлен `http_proxy=http://127.0.0.1:10810`,
  из-за которого встроенная readiness-проверка Playwright `webServer` не видит уже запущенный
  dev-сервер и падает в `EADDRINUSE`. Обход — гонять `npx playwright test` с `http_proxy=""
https_proxy="" NO_PROXY=localhost,127.0.0.1` в env. Если будущий CI использует прокси —
  учесть это же в конфиге/скрипте.

## Следующие шаги

1. Раннер должен создать PR фазы 2 (по правилам ralph.md — PR не создавался вручную).
2. Известный minor из ревью Фазы 1 (не в скоупе Фазы 2): смена seed при client-side навигации
   игнорируется (`game-canvas.tsx` useEffect deps `[]`).
3. После PR — следующая фаза по `docs/game-next/plan.md`: Фаза 3 «Тач-управление».

## Open questions

- Мелочи: favicon 404, unused `setPower` в `game-canvas.tsx` (ESLint warning) — не блокирующие.
- Кто из команды подключается к AtlantaTeam-репо (права, ревью, распределение issues).
- OPENAI_API_KEY для генерации артов — Дима положит в `.env.local` по запросу.
