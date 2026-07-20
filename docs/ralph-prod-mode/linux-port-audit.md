# Аудит кросс-платформенных точек ralph.js / monitor.js (Linux-порт)

**Issue:** #66 · **Дата:** 2026-07-20 · **Для реализации:** #67

Раннер писался и гонялся только на Windows. При `spawnSync/execSync` с `shell:true`
(или без опции — execSync всегда через shell) на Windows вызывается `cmd.exe`,
на Linux — `/bin/sh` (обычно `dash`). Разные шеллы по-разному раскрывают спецсимволы.

## 🔴 Критично — ядро порта (→ #67)

### 1. `runClaudeOnce`: guard + `spawnSync({shell:true})` — ralph.js:199–236

```js
if (/["%]/.test(prompt)) fail('Prompt содержит " или % ...');   // :203
const cmd = `claude -p "${prompt}" --max-turns ${maxTurns}...`;  // :210
const res = spawnSync(cmd, { shell: true, ... });               // :219
```

- **Guard заточен под cmd.exe**: `%` раскрывается как `%VAR%` только в `cmd.exe`.
  На `/bin/sh` `%` безвреден → на Linux guard запрещает `%` **зря**.
- **На `/bin/sh` опасны ДРУГИЕ символы, которых guard НЕ ловит** (промпт в двойных
  кавычках): `` ` `` (**command substitution → выполнение произвольной команды**),
  `$` (раскрытие переменных/`$(...)`), `\` (экранирование). cmd.exe их не трогает,
  `/bin/sh` — трогает.
- **Вектор реален не только для промпта из конфига.** В heal-промпт (ralph.js:1055)
  подставляется `lastRedCheck.excerpt` — хвост вывода упавшего чека (npm/vitest),
  а он вполне может содержать `` ` `` или `$`. Санитизация (ralph.js:493)
  `.replace(/["%]/g, "'")` вырезает только `"` и `%`, но **не** `` ` ``/`$` →
  на Linux вывод теста с backtick утёк бы в shell как команда.

**Решение (#67): уйти от `shell:true` + строковой интерполяции к argv-массиву.**

```js
const cmdArgs = ['-p', prompt, '--max-turns', String(maxTurns)];
if (model) cmdArgs.push('--model', model);
// ...permissionMode / fallbackModel тоже пушим парами
const res = spawnSync('claude', cmdArgs, { shell: false, ... });
```

Аргументы передаются процессу напрямую, **минуя шелл** → никакого раскрытия
`` ` ``/`$`/`%`/`"`. Тогда:

- guard `/["%]/` (ralph.js:203) можно **убрать целиком** — символы больше не опасны;
- санитизация excerpt (ralph.js:493) под guard больше **не нужна**;
- решается разом и кроссплатформенность, и дыра command-injection.

**Windows-совместимость argv — проверено эмпирически (Fable-ревью):** Node не спавнит
`.cmd`/`.bat`-shim без shell (частый ENOENT с npm-глобальными CLI). Но у Димы `claude` —
нативный `.local\bin\claude.exe`, не npm-shim: `spawnSync('claude', ['--version'],
{shell:false})` → `status:0`. Локальный запуск на Windows не ломается; прод — Linux.
В #67 занести это комментарием (при переустановке claude через `npm i -g` риск ENOENT вернётся).

> ⚠️ НЕ «чинить» через `{shell:true}` + массив `args`: Node в этом режиме спецсимволы
> **не экранирует** — дыра остаётся. Только `shell:false`.

## 🟠 Средне — проверить, но низкий риск

### 2. `sh()` — execSync с shell — ralph.js:88, monitor.js:38

Команды `git`/`gh` кроссплатформенны; значения в двойных кавычках
(`--milestone "${milestone}"`). Риск только если аргумент содержит `` ` ``/`$`/`%` —
имена milestone (`Прод-режим ralph · Фаза 1: ...`) их не содержат, но `/bin/sh`
раскрыл бы `$`, попадись он. Опционально в #67 перевести на `execFileSync('gh', [...])`
с массивом — но команды простые, приоритет ниже п.1.

### 3. gh api с `{owner}` / `?` — ralph.js:335,350,363,366; monitor.js

`gh api "repos/{owner}/{repo}/milestones?state=open"` — в двойных кавычках. `/bin/sh`
(dash) brace-expansion не делает, `?`/`{}` в кавычках — literal. **Безопасно**, но
при переходе на argv-массив кавычки убрать (передавать как есть аргументом).

### 4. Line endings / `.gitattributes` — отсутствует

В репо нет `.gitattributes`. Сейчас `ralph.js`/`provision.sh` — LF, и `ralph.js`
запускается через `node` (shebang неважен). Но при постоянной Windows-разработке +
Linux-прод CRLF рано или поздно прилетит в `provision.sh`: `env: bash\r: No such file
or directory`, по-строчный `\r` ломает команды. Фикс: `.gitattributes` с `eol=lf`
(для `*.sh` и `.claude/ralph/**`). Добавлено этим issue.

## 🟢 Уже кроссплатформенно — не трогать

- **Пути**: `CLAUDE_DIR`, `STATE_PATH`, `LOG_PATH` через `path.join`/`path.resolve`
  (ralph.js:64–67, monitor.js:24–28) — разделитель ОС учитывается. ✅
- **`sleep`**: `Atomics.wait(...)` (ralph.js:101) — кроссплатформенно. ✅
- **`git checkout main`**, hardcoded `main` — одинаково. ✅
- **monitor.js** в целом — критичных win32-точек нет; `--jq "length"`/`"."` в двойных
  кавычках на `/bin/sh` literal. ✅

## ⬜ detached-spawn монитора — в коде ПОКА НЕТ

`ralph.js` НЕ спавнит `monitor.js` (запускается вручную). Авто-спавн — Фаза 2 (#74).
При реализации учесть Linux: `spawn(..., { detached: true, stdio: 'ignore' })` + `unref()`.

## Итог для #67

1. Переписать `runClaudeOnce` на argv-массив (`shell:false`) — снимает п.1 целиком.
2. Убрать guard `/["%]/` и санитизацию excerpt под него (станут не нужны).
3. (Опц.) `sh()` git/gh → `execFileSync` с массивом.
4. Прогнать `--dry-run` + одну playground-итерацию на Timeweb-VDS (#70).

**Уточнение по безопасности:** argv закрывает именно _command-injection_ (shell), но
НЕ _prompt-injection_ — `excerpt`/issue-body как текст-инструкция для LLM в
bypassPermissions-сессии остаётся риском C3 (authorAllowlist — отдельный слой, шапка ralph.js).

**Чек-лист для #70 (dry-run на Linux VDS):**

- PATH в non-login контексте (systemd/detached): `gh`/`git`/`npm`/`claude` могут не
  резолвиться, хотя в интерактивном bash работают — проверить под целевым юзером.
- `gh auth status` + git push-креды (token/SSH) от имени юзера, под которым крутится loop.
- ICU-локаль: `monitor.js:142` `toLocaleString('ru-RU')` — на урезанных Node-образах
  small-icu; проверить разом с dry-run.
