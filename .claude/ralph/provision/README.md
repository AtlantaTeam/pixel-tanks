# Provisioning прод-режима ralph

Разворачивание раннера ralph на удалённом Linux-сервере с нуля. Проверено на
**Timeweb Cloud VDS, Ubuntu 24.04 LTS, 4CPU/8GB** (Москва, ru-3).

## Архитектура среды

```
                    ┌─────────────────────── VDS (Timeweb, РФ, Москва) ───────────────────────┐
                    │  ralph.js / claude CLI                                                   │
   человек ── SSH ──┤     │ HTTPS_PROXY=http://127.0.0.1:8118                                  │
                    │     ▼                                                                    │
                    │  privoxy :8118 ──► ss-local :1080 ──Shadowsocks──►  Outline (Франкфурт)  │──► api.anthropic.com
                    │                                                                          │
                    │  git / gh / npm ───────────── напрямую из РФ (NO_PROXY) ─────────────────┼──► github.com / npm
                    └──────────────────────────────────────────────────────────────────────────┘
```

**Почему так:** сервер в РФ (данные по 152-ФЗ, оплата с РФ-карт), но `api.anthropic.com`
из РФ отдаёт Cloudflare-403 → трафик к Anthropic заворачивается через Shadowsocks-туннель
на Outline-сервер во Франкфурте (egress = немецкий IP). GitHub/npm из РФ работают напрямую —
их через туннель не гоним (быстрее, меньше нагрузка на туннель).

## Порядок развёртывания

### 0. Создать VDS (Timeweb MCP или панель)

- Ubuntu 24.04, preset 4CPU/8GB (в наличии — Москва `preset_id=4803`; СПб/НСК бывают без ёмкости).
- Прописать SSH-ключи при создании.
- **Добавить публичный IPv4** — тариф по умолчанию выдаёт IPv6-only
  (`add_server_ip type=ipv4` или панель). Без IPv4 нет ни SSH, ни туннеля.

### 1. Подготовить секреты (руками, на машине с браузером)

- `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` (подписка Max, headless-токен).
- `gh auth token` (или создать PAT scope `repo`) → `GH_TOKEN`.
- Outline Manager → access-key → из него `SS_PASSWORD` (метод/host/port — см. `ralph.env.example`).

### 2. Заполнить env

```bash
cp ralph.env.example ralph.env
# заполнить CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, SS_PASSWORD
```

### 3. Залить и запустить провижн

```bash
scp provision.sh ralph.env root@<ip>:/root/
ssh root@<ip> 'chmod 600 /root/ralph.env && ENV_FILE=/root/ralph.env bash /root/provision.sh'
```

Скрипт идемпотентен, ставит всё окружение и падает с явной ошибкой, если туннель
не поднялся (health-check egress ≠ Франкфурт).

### 4. Проверить

```bash
ssh root@<ip>
set -a && . /root/ralph.env && set +a
cd /root/pixel-tanks
claude -p 'Ответь одним словом: OK'          # → OK (через туннель)
curl -x http://127.0.0.1:8118 https://api.ipify.org   # → IP Франкфурта
npm run build && npm run test                # гейт-чеки
```

## Подводные камни (уже учтены в provision.sh)

| Симптом                                                       | Причина                                                                                              | Решение                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `ss-local`: `Invalid config path`, юнит `failed`              | пакетный юнит `shadowsocks-libev-local@` с `DynamicUser=true` → случайный uid не читает конфиг `600` | drop-in override: `User=root` + `Restart=always` |
| `npm ci`: postinstall не выполнены (esbuild/sharp)            | npm 11 блокирует lifecycle-скрипты (allow-scripts)                                                   | `npm rebuild esbuild sharp unrs-resolver`        |
| claude: `workspace has not been trusted`, игнорит permissions | нет trust-флага для папки                                                                            | `hasTrustDialogAccepted:true` в `~/.claude.json` |
| VDS без публичного IPv4                                       | тариф Timeweb выдаёт IPv6-only                                                                       | `add_server_ip type=ipv4`                        |

## Осталось (не в этом скрипте — Фазы 1-2 плана)

- **Linux-порт `ralph.js`** — писался под Windows (`spawnSync shell:true` → `/bin/sh`,
  guard `%`/`"` под cmd.exe). Прогнать `--dry-run`, починить (#66–70).
- **prod-профиль** (`--profile prod`) — в коде ещё нет (Фаза 2, #71–75).
- **systemd-юнит для ralph** + health-check туннеля перед итерацией — после prod-профиля.
