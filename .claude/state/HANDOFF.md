# Session Handoff

**Дата**: 2026-07-18

## Текущая задача

Game-next (фазы 4–9). **Фаза 4 (клавиатура) завершена и смерджена** (#46).
Ralph loop переписан на **полный AFK-цикл сдачи фазы** и укреплён по ревью fable.
Всё смерджено, main чистый — готово к рестарту loop **после решения по C3**.

## Что сделано в этой сессии

- **Redesign ralph.js**: после закрытия issues фазы loop сам гонит
  `PR → code review (отд. модель) → авто-правки по ревью → детерминированный
гейт → squash-merge → следующая фаза`. Гейт (раннер сам, не доверяя агенту):
  нет `blocked` + локальный HEAD==голова PR + зелёные `build/lint/lint:fsd/
typecheck/test`. Красный/blocked → PR человеку, loop стоп. Смерджено в #47.
- **Ревью fable** всей ralph-инфры → исправлены ВСЕ находки (C1–C4, H1–H4,
  M1–M8, часть Low) с подробными комментариями. Ключевое: C1 (`--dry-run`
  read-only), C2 (blocked/чужие issues блокируют сдачу), **C3 (`authorAllowlist:
["Pelmenya"]` против инъекции — репо PUBLIC + bypassPermissions)**, C4
  (preflight-инвариант «прошлые фазы смерджены» + state по имени milestone).
- **Мерджи**: инфра #47 + Фаза 4 #46. Milestone Фазы 4 закрыт. Заведён **#48**
  (полировка клавиатуры по ревью, milestone Фаза 6, low).

## Состояние на сейчас

- main = origin/main = `7c16105` (чисто). state = `{count:0, milestone:"Фаза 4",
submitted:false}` — loop на рестарте увидит Фазу 4 смердженной и сам перейдёт
  на Фазу 5 (проверено `--dry-run`).
- state/log — gitignored (ensureClean их не видит). authorAllowlist=["Pelmenya"].

## Следующие шаги

1. **РЕШИТЬ C3** (операционный слой, за Димой): гонять AFK на public-репо как
   есть (allowlist прикрывает код-слой, но не 100%) / сделать репо private на
   время прогонов / песочница-VM. Раннер видимость репо НЕ меняет.
2. Рестарт: `node .claude/ralph/ralph.js` (фоново) → AFK по фазам 5–9.
   Теперь loop **сам мерджит** на зелёном гейте и **стоит** на красном/blocked.
3. Финальный гейт после Фазы 9 — `/code-review ultra` по всему game-next.

## Open questions

- C3: public vs private vs песочница — до рестарта AFK.
- OPENAI_API_KEY для генерации артов (Фаза 6) — Дима в .env.local по запросу.
