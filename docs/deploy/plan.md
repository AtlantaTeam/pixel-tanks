# Plan: прод-деплой на VDS с авто-TLS и авто-деплоем из GitHub

**PRD:** [docs/deploy/prd.md](./prd.md)
**Дата:** 2026-07-20

> Инфраструктурная фича — «тесты» здесь это проверяемые команды (`dig`, `curl -I`,
> reboot, внешний скан порта, тест restore), а не unit-тесты. Каждая фаза даёт
> рабочий результат, после любой можно остановиться.

## Фазы реализации

### Фаза 1: Сайт вживую по HTTPS (ручной деплой) — Tracer Bullet

**Цель:** `https://pixeltanks.ru` отдаёт приложение с валидным TLS, поднятое руками.
Тонкий сквозной срез через все слои: DNS → Caddy → systemd → Next → Payload/SQLite.
**Затрагивает:** infra (VDS, DNS, systemd, Caddy), database (каталог payload.db)
**Задачи:**

- [ ] Подготовка ОС: swap-файл 2–4 GB + запись в `/etc/fstab`; `ufw` разрешает только `22/80/443`, включён; проверить, что `3060` наружу закрыт.
- [ ] DNS в Timeweb: A `pixeltanks.ru`/`www` → `186.246.7.204`, AAAA → `2a03:6f00:a::2:d005`; дождаться распространения (`dig`).
- [ ] Прод-окружение: deploy-пользователь (не root); git-клон `main` в `/opt/pixel-tanks` (физически отдельно от рабочей копии ralph `/root/pixel-tanks`); каталог БД вне клона; `EnvironmentFile` (`/etc/pixel-tanks/env`, права 600) с **новыми** `PAYLOAD_SECRET`/`DATABASE_URI`, `NODE_ENV=production`, `PORT=3060`.
- [ ] systemd-юнит `pixel-tanks.service`: `WorkingDirectory=/opt/pixel-tanks`, `next start` на `:3060`, `Restart=always`, `EnvironmentFile`, `enable`; первый билд+старт руками (`npm ci && npm run build && systemctl start`).
- [ ] Caddy как systemd-сервис + `Caddyfile`: авто-TLS Let's Encrypt для `pixeltanks.ru`/`www`, `:80`→`https`, `www`→apex, `reverse_proxy 127.0.0.1:3060`, `enable`.

**Когда готова:** `https://pixeltanks.ru` открывается с валидным TLS (замок); `http://` и `www` редиректят на apex-https; `dig` возвращает нужные A/AAAA; после `reboot` сайт и Caddy поднимаются сами; ralph-loop и Shadowsocks-туннель остаются `active`; секретов нет в git; прод-секреты ≠ «засвеченным»; swap активен.

### Фаза 2: Авто-деплой из GitHub (push → прод) с автооткатом

**Цель:** push в `main` без ручных действий обновляет прод; плохой коммит откатывается сам.
**Затрагивает:** infra (SSH, sudoers), CI (GitHub Actions)
**Задачи:**

- [ ] Deploy-SSH-ключ: сгенерировать выделенную пару; публичный → `authorized_keys` deploy-пользователя; приватный + `DEPLOY_HOST`/`DEPLOY_USER` → GitHub repo secrets.
- [ ] `sudoers`-правило: deploy-пользователю `NOPASSWD` строго на `systemctl restart pixel-tanks` (и `reload caddy`), больше ничего.
- [ ] `.github/workflows/deploy.yml`: триггер `push` в `main` → SSH на VDS → в `/opt/pixel-tanks`: `git pull && npm ci && npm run build && sudo systemctl restart pixel-tanks`; логи в Actions.
- [ ] Healthcheck-шаг после restart: дёрнуть `https://pixeltanks.ru` (ожидать `200`); при не-`200` в таймаут — автооткат на предыдущий коммит (`git reset --hard` prev SHA + `ci` + `build` + `restart`), workflow падает с ненулевым кодом.

**Когда готова:** тестовое видимое изменение после мержа в `main` само появляется на `https://pixeltanks.ru`, лог виден в Actions; заведомо ломающий рантайм коммит → healthcheck ловит не-`200` → прод автоматически откатывается на рабочую версию, сайт остаётся живым, workflow `failed`; deploy-пользователь не root и любой другой `sudo` отклоняется.

### Фаза 3: Эксплуатация — бэкап и защита данных

**Цель:** данные `payload.db` защищены от кривого деплоя/миграции; есть проверенное восстановление.
**Затрагивает:** infra (cron/systemd-timer), database
**Задачи:**

- [ ] Скрипт бэкапа: `sqlite3 payload.db .backup` в `/var/backups/pixel-tanks/` с таймстампом; ротация — хранить последние N дней (напр. 7).
- [ ] systemd-timer (или cron) — ежедневный запуск скрипта; `enable`, переживает reboot.
- [ ] Тест восстановления: восстановить БД из свежего дампа в отдельный каталог, поднять приложение на нём, убедиться, что данные на месте.

**Когда готова:** свежий дамп `payload.db` появляется по расписанию, ротация удаляет старые; восстановление из бэкапа проверено вручную и работает.

## Покрытие критериев готовности PRD

| Критерий PRD                           | Фаза                   |
| -------------------------------------- | ---------------------- |
| https + валидный TLS                   | 1                      |
| http/www → редирект                    | 1                      |
| dig A/AAAA                             | 1                      |
| push → авто-деплой                     | 2                      |
| TLS авто-продление                     | 1 (Caddy)              |
| reboot → сам поднимается               | 1                      |
| payload.db переживает деплой           | 1 (вне клона) + 2      |
| ufw 22/80/443, 3060 закрыт             | 1                      |
| deploy-user не root, ограниченный sudo | 1 (user) + 2 (sudoers) |
| секретов нет в git                     | 1 + 2                  |
| соседи (ralph/туннель) не задеты       | 1                      |
| прод-секреты ≠ «засвеченным»           | 1                      |
| swap активен                           | 1                      |
| автооткат работает                     | 2                      |
| cron-бэкап + ротация                   | 3                      |
