#!/usr/bin/env bash
#
# Управляемый запуск ralph в tmux (Issue #103, вариант A — HITL/наблюдаемый прогон).
# Поднимает ОТДЕЛЬНУЮ tmux-сессию `ralph` (не смешивать с рабочей сессией `work` из
# RUNBOOK.md — там окна переиндексируются при закрытии, здесь фиксированные две
# панели одного окна) — не зависит от SSH-разрыва, живёт пока жив tmux-сервер.
#
# Раскладка: одно окно `ralph`, две панели:
#   0 (верхняя) — node ralph.js --profile <profile>
#   1 (нижняя)  — node runtime/monitor.js (дашборд; ждёт появления дерева раннера)
#
# Панель монитора — удобство наблюдения, не обязательное условие: ralph.js поднимает
# СВОЙ detached-monitor.js сам (deadman читает свежесть ralph.log независимо от того,
# attach'нут ли кто-то к tmux). Второй экземпляр в панели безопасен — read-only,
# pid-файл не трогает (RUNBOOK.md, «Запуск»).
#
# ЗАПУСК (на VDS, под root):
#   .claude/ralph/provision/start-tmux.sh [профиль]     # профиль по умолчанию — prod
#
set -euo pipefail

PROFILE="${1:-prod}"
SESSION="${RALPH_TMUX_SESSION:-ralph}"
REPO_DIR="${REPO_DIR:-/root/pixel-tanks}"
RUNNER_DIR="${RALPH_WORKTREE_PATH:-${REPO_DIR}-ralph}"
ENV_FILE="${RALPH_ENV_FILE:-/root/ralph.env}"

command -v tmux >/dev/null 2>&1 || { echo "нет tmux в PATH" >&2; exit 1; }
[ -d "$REPO_DIR" ] || { echo "нет $REPO_DIR — сначала provision.sh" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "нет $ENV_FILE — заполни секреты (ralph.env.example), положи туда (chmod 600)" >&2; exit 1; }

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "tmux-сессия '$SESSION' уже существует — attach: tmux attach -t $SESSION" >&2
    exit 1
fi

tmux new-session -d -s "$SESSION" -n ralph -c "$REPO_DIR"
tmux send-keys -t "${SESSION}:ralph.0" \
    "set -a && . '$ENV_FILE' && set +a && node .claude/ralph/ralph.js --profile $PROFILE" Enter

tmux split-window -v -t "${SESSION}:ralph.0" -c "$REPO_DIR"
tmux send-keys -t "${SESSION}:ralph.1" \
    "until [ -d '$RUNNER_DIR' ]; do sleep 2; done; cd '$RUNNER_DIR' && node .claude/ralph/runtime/monitor.js --profile $PROFILE --interval 60 --config '$REPO_DIR/.claude/ralph/ralph.config.json'" Enter

tmux select-pane -t "${SESSION}:ralph.0"

cat <<EOF
Готово: tmux attach -t $SESSION
  панель 0 — ralph.js (профиль $PROFILE)
  панель 1 — monitor.js (дождётся дерева раннера $RUNNER_DIR и запустится сама)
EOF
