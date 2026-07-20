#!/usr/bin/env bash
#
# Провижн прод-режима ralph на свежей Ubuntu 24.04 LTS (Timeweb Cloud VDS).
# Разворачивает: системные пакеты, Node 24, gh CLI, Claude Code CLI,
# Shadowsocks-туннель к Anthropic через Франкфурт, клон репо + зависимости,
# Playwright+chromium, gh-auth, trust папки, ufw. Идемпотентен — можно гонять повторно.
#
# ПРЕДУСЛОВИЯ (руками, до запуска):
#   1. VDS создан (Timeweb MCP create_server, preset 4/8, Ubuntu 24.04).
#      ВНИМАНИЕ: тариф может выдать IPv6-only — публичный IPv4 добавить отдельно
#      (Timeweb MCP add_server_ip type=ipv4, или панель). Без IPv4 нет ни SSH, ни туннеля.
#   2. SSH-ключ прописан при создании (ssh_keys_ids), заходишь root@<ip>.
#   3. Заполнен env-файл (см. ralph.env.example) и положен в $ENV_FILE (600).
#
# ЗАПУСК:  scp provision.sh ralph.env root@<ip>:/root/  &&  ssh root@<ip> 'ENV_FILE=/root/ralph.env bash /root/provision.sh'
#
set -euo pipefail

ENV_FILE="${ENV_FILE:-/root/ralph.env}"
REPO_URL="${REPO_URL:-https://github.com/AtlantaTeam/pixel-tanks.git}"
REPO_DIR="${REPO_DIR:-/root/pixel-tanks}"

log() { echo -e "\n\033[1;36m=== $* ===\033[0m"; }
die() { echo -e "\033[1;31mОШИБКА: $*\033[0m" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "нет $ENV_FILE — скопируй ralph.env.example, заполни секреты, положи в $ENV_FILE (chmod 600)"
set -a; . "$ENV_FILE"; set +a
: "${SS_SERVER:?нет в env}" "${SS_PORT:?}" "${SS_METHOD:?}" "${SS_PASSWORD:?}"

export DEBIAN_FRONTEND=noninteractive

log "1/9 Системные пакеты"
apt-get update -qq
apt-get install -y -qq curl wget git build-essential python3 ufw \
    shadowsocks-libev privoxy

log "2/9 Node 24 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 24 ]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y -qq nodejs
fi
echo "node $(node -v), npm $(npm -v)"

log "3/9 gh CLI"
if ! command -v gh >/dev/null 2>&1; then
    mkdir -p -m 755 /etc/apt/keyrings
    wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list
    apt-get update -qq && apt-get install -y -qq gh
fi

log "4/9 Claude Code CLI"
npm i -g @anthropic-ai/claude-code
echo "claude $(claude --version 2>/dev/null | head -1)"

log "5/9 Shadowsocks-туннель → privoxy (весь трафик claude идёт через Франкфурт)"
# ss-local: SOCKS5 127.0.0.1:1080 → Outline/Shadowsocks во Франкфурте
cat > /etc/shadowsocks-libev/frankfurt.json <<JSON
{
  "server": "$SS_SERVER",
  "server_port": $SS_PORT,
  "local_address": "127.0.0.1",
  "local_port": 1080,
  "password": "$SS_PASSWORD",
  "method": "$SS_METHOD",
  "mode": "tcp_and_udp",
  "timeout": 300
}
JSON
chmod 600 /etc/shadowsocks-libev/frankfurt.json
systemctl disable --now shadowsocks-libev 2>/dev/null || true   # дефолтный ss-server не нужен
# ВАЖНО: пакетный юнит shadowsocks-libev-local@ имеет DynamicUser=true → случайный uid
# не читает конфиг 600 ("Invalid config path"). Override: root + автоперезапуск.
mkdir -p /etc/systemd/system/shadowsocks-libev-local@frankfurt.service.d
cat > /etc/systemd/system/shadowsocks-libev-local@frankfurt.service.d/override.conf <<'CONF'
[Service]
DynamicUser=false
User=root
Group=root
Restart=always
RestartSec=3
CONF
# privoxy: HTTP 127.0.0.1:8118 → форвардит в SOCKS5 туннеля (5t = remote-DNS через туннель)
grep -q "forward-socks5t / 127.0.0.1:1080" /etc/privoxy/config \
    || echo "forward-socks5t / 127.0.0.1:1080 ." >> /etc/privoxy/config
systemctl daemon-reload
systemctl enable --now shadowsocks-libev-local@frankfurt privoxy
systemctl restart shadowsocks-libev-local@frankfurt privoxy

log "6/9 Health-check туннеля (egress должен быть Франкфурт = $SS_SERVER)"
sleep 2
EGRESS="$(curl -s --max-time 15 -x http://127.0.0.1:8118 https://api.ipify.org || true)"
[ "$EGRESS" = "$SS_SERVER" ] || die "egress='$EGRESS', ждали '$SS_SERVER' — туннель не поднялся"
echo "OK: egress через прокси = $EGRESS"

log "7/9 Клон репо + зависимости"
[ -d "$REPO_DIR/.git" ] || git clone "$REPO_URL" "$REPO_DIR"
cd "$REPO_DIR"
npm ci
npm rebuild esbuild sharp unrs-resolver   # npm 11 блокирует postinstall — досбор native
npx playwright install --with-deps chromium

log "8/9 gh auth + trust папки для claude"
if [ -n "${GH_TOKEN:-}" ]; then
    gh auth status 2>/dev/null || true
    gh auth setup-git
    gh api "repos/AtlantaTeam/pixel-tanks" --jq '.full_name' >/dev/null && echo "gh: доступ к репо OK"
fi
node -e '
const fs=require("fs");const p=process.env.HOME+"/.claude.json";
const j=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};
j.projects=j.projects||{};
const dir=process.argv[1];
j.projects[dir]={...(j.projects[dir]||{}),hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true};
fs.writeFileSync(p,JSON.stringify(j,null,2));
console.log("trust set for "+dir);
' "$REPO_DIR"

log "9/9 ufw SSH-only"
ufw allow 22/tcp
ufw --force enable

log "ГОТОВО"
echo "Проверка claude через туннель:"
echo "  cd $REPO_DIR && set -a && . $ENV_FILE && set +a && claude -p 'Ответь одним словом: OK'"
echo "Запуск ralph (после реализации prod-профиля, Фаза 2):"
echo "  cd $REPO_DIR/.claude/ralph && set -a && . $ENV_FILE && set +a && node ralph.js --profile prod"
