---
globs: 'src/payload/**,src/app/(payload)/**'
---

# Payload CMS 3

- Серверный код в Next.js — через **Local API** (`payload.find/create/...`), не REST к самому себе. REST — только для клиентских запросов через TanStack Query.
- Сложные запросы (агрегации лидерборда, джойны) — `payload.db.drizzle`, НЕ отдельный клиент Drizzle.
- Каждая коллекция — обязательный `access` (read/create/update/delete); дефолт «всем можно» недопустим.
- После изменения коллекций — перегенерировать типы: `npx payload generate:types`; руками типы коллекций не писать.
- Побочные эффекты (пересчёт лидерборда, нормализация) — в hooks коллекций, не в роутах.
- Секреты (`PAYLOAD_SECRET`, `DATABASE_URI`) — только из env; `payload.db` (SQLite) не коммитить.
- Детали и отладка (валидация, транзакции, access, hooks) — скилл `payload`.
