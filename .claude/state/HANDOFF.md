# Session Handoff

**Дата**: 2026-07-18

## Текущая задача

Ralph-цикл по Фазе 2 (мобильный layout). Issue #5 (вьюпорт: h-dvh, safe-area, touch-action, запрет
h-скролла) закрыт и запушен в `feature/phase-2-mobile` (коммит 2333f2b). Следующие в очереди по
возрастанию номера: #6 (адаптивный HUD, тач-цели ≥ 44px), #7 (devicePixelRatio + ResizeObserver),
#8 (Playwright-проверка вьюпортов).

## Последние принятые решения

- Safe-area — переиспользуемая Tailwind-утилита `safe-area-inset` в `globals.css` (padding через
  `env(safe-area-inset-*)` на всех 4 сторонах), применена на корневом `<main>` игровой страницы.
- `touch-action: none` — через Tailwind-класс `touch-none` прямо на `<canvas>`.
- `overflow-x: hidden` добавлен на html/body в globals.css глобально (не только для game-page).
- Playwright MCP browser был залочен зависшим процессом chrome.exe от предыдущей сессии
  (профиль `mcp-chrome-fad4cbb`) — пришлось `taskkill`, чтобы снять блокировку `browser_navigate`.
  Если повторится — тот же fix (все процессы с этим user-data-dir безопасно убивать, это выделенный
  автоматизационный профиль, не личный браузер Димы).

## Следующие шаги

1. Запустить раннер на Issue #6 (адаптивный HUD, sonnet).
2. Известный minor из ревью Фазы 1: смена seed при client-side навигации игнорируется
   (`game-canvas.tsx` useEffect deps `[]`) — не входит в issues Фазы 2, чинить отдельно.
3. После всех issues Фазы 2 — раннер сам создаст PR + ревью (opus).

## Open questions

- Мелочи: favicon 404 (не относится к Фазе 2), unused `setPower` в game-canvas.tsx (ESLint warning).
- Кто из команды подключается к AtlantaTeam-репо (права, ревью, распределение issues).
- OPENAI_API_KEY для генерации артов — Дима положит в `.env.local` по запросу.
