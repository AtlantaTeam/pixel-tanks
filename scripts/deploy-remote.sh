#!/usr/bin/env bash
# Прод-деплой pixel-tanks. Запускается НА VDS под пользователем `deploy`,
# вызывается из GitHub Actions по SSH (см. .github/workflows/deploy.yml).
#
# Логика: подтянуть main → собрать → рестарт → healthcheck.
# Если healthcheck не отдаёт 200 — автооткат на предыдущий коммит и выход с ошибкой,
# чтобы прод не оставался лежать из-за плохого коммита.
set -euo pipefail

PROD_DIR=/opt/pixel-tanks
ENV_FILE=/etc/pixel-tanks/env
HEALTH_URL=https://pixeltanks.ru/
HEALTH_RETRIES=20
HEALTH_DELAY=3

cd "$PROD_DIR"

git fetch --depth 1 origin main
PREV_SHA=$(git rev-parse HEAD)
TARGET_SHA=$(git rev-parse origin/main)

# Раскатать конкретный коммит: код → зависимости → сборка → рестарт.
release() {
    local sha=$1
    git reset --hard "$sha"
    # --include=dev обязателен: сборке нужны devDeps (tailwind/tsc),
    # а EnvironmentFile ниже выставляет NODE_ENV=production, который иначе их отрезал бы.
    npm ci --include=dev --no-audit --no-fund
    # Секреты и NODE_ENV=production — только для сборки/рантайма, не для npm ci выше.
    set -a; . "$ENV_FILE"; set +a
    npm run build
    sudo systemctl restart pixel-tanks
}

# Прод жив, если отдаёт 200 (через Caddy/HTTPS) в пределах ретраев.
healthy() {
    local code
    for _ in $(seq 1 "$HEALTH_RETRIES"); do
        code=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)
        [ "$code" = "200" ] && return 0
        sleep "$HEALTH_DELAY"
    done
    return 1
}

echo "▶ Деплой $PREV_SHA → $TARGET_SHA"
release "$TARGET_SHA"

if healthy; then
    echo "✓ Healthcheck OK — деплой успешен ($TARGET_SHA)"
    exit 0
fi

echo "✗ Healthcheck провалился — откат на $PREV_SHA"
release "$PREV_SHA"
if healthy; then
    echo "✓ Откат успешен, прод жив на предыдущей версии ($PREV_SHA)"
else
    echo "✗✗ Откат тоже не поднял healthcheck — требуется ручное вмешательство"
fi
exit 1
