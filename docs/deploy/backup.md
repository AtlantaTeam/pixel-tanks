# Бэкап прод-БД pixel-tanks

Защита данных `payload.db` от кривого деплоя/миграции. Онлайн-дамп SQLite на диск
VDS с ротацией. Offsite (S3) — вне скоупа этой итерации (см. `prd.md`).

Составляющие:

| Часть                      | Файл                                        | Issue |
| -------------------------- | ------------------------------------------- | ----- |
| Скрипт бэкапа + ротация    | `scripts/backup-db.sh`                      | #119  |
| systemd-таймер (ежедневно) | `deploy/pixel-tanks-backup.{service,timer}` | #120  |
| Проверка восстановления    | этот файл, раздел «Restore»                 | #121  |

## Что делает скрипт

`scripts/backup-db.sh`:

- Путь к БД берёт из `DATABASE_URI` в `/etc/pixel-tanks/env` (единый источник
  правды; снимает префикс `file:`). Переопределяется через `DB_PATH`.
- Онлайн-дамп через `sqlite3 "$DB" ".backup ..."` — безопасен при работающем
  приложении (учитывает WAL и блокировки), в отличие от `cp`.
- Кладёт `payload-<TS>.db` в `/var/backups/pixel-tanks/` (каталог `700 root:root`).
- **Fail-closed**: после дампа гоняет `PRAGMA integrity_check`; если не `ok` —
  удаляет битый дамп и выходит с ошибкой.
- Ротация: удаляет дампы старше `RETENTION_DAYS` суток (по умолчанию 7).

Параметры-переопределения (env): `ENV_FILE`, `DB_PATH`, `BACKUP_DIR`, `RETENTION_DAYS`.

Ручной прогон на VDS:

```bash
sudo /opt/pixel-tanks/scripts/backup-db.sh
```

## Установка таймера (однократно, на VDS под root)

Скрипт приезжает в `/opt/pixel-tanks/scripts/` штатным деплоем. Unit-файлы
ставятся руками один раз (нужен root, деплой их не трогает):

```bash
sudo cp /opt/pixel-tanks/deploy/pixel-tanks-backup.service /etc/systemd/system/
sudo cp /opt/pixel-tanks/deploy/pixel-tanks-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pixel-tanks-backup.timer
```

Проверка:

```bash
systemctl list-timers pixel-tanks-backup.timer   # видно NEXT/LAST
systemctl start pixel-tanks-backup.service        # разовый прогон вручную
journalctl -u pixel-tanks-backup.service --no-pager | tail
ls -la /var/backups/pixel-tanks/
```

`Persistent=true` в таймере: пропущенный из-за выключения/reboot запуск
догоняется при следующей загрузке — бэкап переживает reboot.

## Restore (проверка восстановления, #121)

Бэкап без проверенного restore — не бэкап. Проверка вручную:

```bash
# 1. Взять свежий дамп
DUMP=$(ls -t /var/backups/pixel-tanks/payload-*.db | head -1)

# 2. Целостность и содержимое
sqlite3 "$DUMP" 'PRAGMA integrity_check;'                    # ok
sqlite3 "$DUMP" '.tables'                                    # коллекции на месте
sqlite3 "$DUMP" 'SELECT count(*) FROM users;'               # данные на месте

# 3. Поднять приложение на восстановленной БД (в отдельном каталоге, не трогая прод)
install -m 644 "$DUMP" /tmp/restore-check/payload.db
DATABASE_URI="file:/tmp/restore-check/payload.db" PORT=3099 npm --prefix /opt/pixel-tanks start
# → открыть http://localhost:3099, убедиться что данные видны
```
