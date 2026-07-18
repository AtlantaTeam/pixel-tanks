---
name: issues
description: Создаёт GitHub milestones и issues из файла плана. Использовать, когда есть готовый план с фазами и нужно завести бэклог на GitHub.
---

# Issues Generator

Прочитай план из файла: $ARGUMENTS

Для каждой фазы создай milestone и issues через gh CLI.

## Порядок действий

1. Прочитай файл плана.
2. Проверь существующие milestones (идемпотентность — не создавай дубли):
   `gh api repos/:owner/:repo/milestones --jq '.[].title'`
3. Для каждой фазы создай milestone (если ещё нет):
   `gh api repos/:owner/:repo/milestones -f title="Фаза N: название"`
4. Для каждой задачи фазы создай Issue:
   `gh issue create --title "..." --body "..." --milestone "Фаза N: название"`
5. **Доска (GitHub Projects, обязательно)** — issues должны попасть на доску проекта:
    - Найди доску: `gh project list --owner <owner>`; если нет — создай (`gh project create --owner <owner> --title "<имя проекта>"`) и привяжи к репо (`gh project link <number> --owner <owner> --repo <owner/repo>`)
    - Добавь каждый созданный issue: `gh project item-add <number> --owner <owner> --url <issue-url>`
    - Проверь счётчик с запасом по лимиту: `gh project item-list <number> --owner <owner> --limit 100 --format json --jq '.items | length'` (без `--limit` вернёт максимум 30 — обманчиво)

## Формат Issue

- **Title**: текст задачи из плана (без чекбокса `[ ]`).
- **Body**: описание задачи + раздел «Критерии готовности» — конкретные проверяемые пункты, выведенные из плана и PRD. Именно по ним автономный агент поймёт, что задача закрыта.

## Правила

- Порядок issues = порядок задач в плане (агент берёт их по номерам).
- Не выдумывай задачи, которых нет в плане.
- Много однотипных вызовов gh — оформи bash-скриптом в scratchpad, не десятками отдельных команд.
- В конце выведи компактную сводку: milestone → количество issues + ссылка на доску.
