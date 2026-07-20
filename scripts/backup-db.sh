#!/usr/bin/env bash
# Бэкап прод-БД pixel-tanks (SQLite). Онлайн-дамп через `sqlite3 .backup` —
# безопасен при работающем приложении: учитывает WAL и блокировки, в отличие
# от простого `cp`, который может поймать несогласованное состояние при записи.
#
# Запускается по расписанию (systemd-timer, см. #120) или руками на VDS.
# Путь к БД берётся из EnvironmentFile прода (DATABASE_URI) — единый источник
# правды. Все параметры переопределяются переменными окружения (для тестов).
#
#   ENV_FILE        путь к EnvironmentFile прода (по умолч. /etc/pixel-tanks/env)
#   DB_PATH         явный путь к payload.db (иначе — из DATABASE_URI в ENV_FILE)
#   BACKUP_DIR      каталог дампов (по умолч. /var/backups/pixel-tanks)
#   RETENTION_DAYS  сколько дней хранить дампы (по умолч. 7)
set -euo pipefail

ENV_FILE=${ENV_FILE:-/etc/pixel-tanks/env}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/pixel-tanks}
RETENTION_DAYS=${RETENTION_DAYS:-7}

# Путь к БД: из DB_PATH, иначе из DATABASE_URI в ENV_FILE (снимаем префикс file:).
resolve_db_path() {
    if [ -n "${DB_PATH:-}" ]; then
        printf '%s' "$DB_PATH"
        return
    fi
    [ -r "$ENV_FILE" ] || { echo "✗ EnvironmentFile недоступен: $ENV_FILE" >&2; exit 1; }
    local uri
    uri=$(grep -E '^DATABASE_URI=' "$ENV_FILE" | head -1 | cut -d= -f2-)
    [ -n "$uri" ] || { echo "✗ DATABASE_URI не найден в $ENV_FILE" >&2; exit 1; }
    printf '%s' "${uri#file:}"
}

DB=$(resolve_db_path)
[ -f "$DB" ] || { echo "✗ БД не найдена: $DB" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TS=$(date +%Y%m%d-%H%M%S)
DEST="$BACKUP_DIR/payload-$TS.db"

# Онлайн-бэкап через встроенный backup API SQLite.
sqlite3 "$DB" ".backup '$DEST'"

# Fail-closed: битый дамп — не бэкап. Проверяем целостность, иначе удаляем и падаем.
check=$(sqlite3 "$DEST" 'PRAGMA integrity_check;' 2>&1 || true)
if [ "$check" != "ok" ]; then
    echo "✗ integrity_check провалился для $DEST: $check" >&2
    rm -f "$DEST"
    exit 1
fi

echo "✓ Бэкап создан: $DEST ($(du -h "$DEST" | cut -f1))"

# Ротация: удалить дампы старше RETENTION_DAYS суток. -mtime +N = старше N*24ч.
deleted=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'payload-*.db' \
    -mtime "+$RETENTION_DAYS" -print -delete | wc -l)
if [ "$deleted" -gt 0 ]; then
    echo "🗑  Ротация (>$RETENTION_DAYS дн.): удалено дампов: $deleted"
fi

exit 0
