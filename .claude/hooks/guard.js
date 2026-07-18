#!/usr/bin/env node
/**
 * PreToolUse hook — жёсткая граница безопасности (детерминированная, не advisory).
 *
 * Блокирует:
 *   - чтение секретов (.env и вариации) через Read и через Bash (cat/type/less...)
 *   - деструктивные команды: rm -rf, git reset --hard, git push --force,
 *     git clean -fd, drop database, prisma migrate reset
 *
 * Input (stdin): JSON { tool_name, tool_input }
 * Exit 2 + stderr => инструмент блокируется, сообщение уходит агенту.
 * Exit 0 => разрешено.
 *
 * Never throws — при любой ошибке парсинга пропускаем (exit 0),
 * основная защита продублирована в permissions.deny.
 */

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(data), 5000);
  });
}

// .env, .env.local, apps/api/.env — но НЕ .env.example / .env.sample
const ENV_FILE_RE = /(^|[\\\/])\.env(\.(?!example|sample)[\w.-]+)?$/i;
// то же для упоминания внутри shell-команды: .env после пробела/слэша/кавычки/начала строки
const CMD_ENV_RE = /(^|[\s\\\/"'=])\.env(\.(?!example|sample)[\w.-]+)?(\s|$|["';|])/i;

const DESTRUCTIVE_BASH = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\b/i, why: 'rm -rf запрещён. Удаляй файлы точечно и объясняй зачем.' },
  { re: /\bgit\s+reset\s+--hard\b/i, why: 'git reset --hard запрещён (теряет незакоммиченную работу). Используй git stash.' },
  { re: /\bgit\s+push\s+.*(--force\b|-f\b)(?!-with-lease)/i, why: 'git push --force запрещён. Если правда нужно — --force-with-lease и спроси пользователя.' },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, why: 'git clean -f запрещён (удаляет неотслеживаемые файлы).' },
  { re: /\bgit\s+checkout\s+\.(\s|$)/i, why: 'git checkout . запрещён (затирает незакоммиченные изменения).' },
  { re: /\bdrop\s+(database|schema|table)\b/i, why: 'DROP database/schema/table запрещён из агентской сессии.' },
  { re: /\bprisma\s+migrate\s+reset\b/i, why: 'prisma migrate reset запрещён (сносит базу). Спроси пользователя.' },
];

async function main() {
  const raw = await readStdin();
  if (!raw) return;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  const tool = input.tool_name || '';
  const ti = input.tool_input || {};

  if (tool === 'Read' || tool === 'Edit' || tool === 'Write') {
    const p = ti.file_path || '';
    if (ENV_FILE_RE.test(p)) {
      process.stderr.write(
        `Доступ к ${p} заблокирован: файлы .env содержат секреты. ` +
          'Используй .env.example для структуры переменных.',
      );
      process.exit(2);
    }
  }

  if (tool === 'Bash') {
    const cmd = ti.command || '';

    // Чтение .env через shell (cat .env, type .env, cp .env ...)
    if (CMD_ENV_RE.test(cmd)) {
      // разрешаем безобидные упоминания в комментариях echo — блокируем только команды чтения/копирования
      if (/\b(cat|type|less|more|head|tail|cp|copy|scp|curl|Get-Content|gc)\b/i.test(cmd)) {
        process.stderr.write(
          'Команда заблокирована: чтение/копирование .env файлов запрещено (секреты).',
        );
        process.exit(2);
      }
    }

    for (const rule of DESTRUCTIVE_BASH) {
      if (rule.re.test(cmd)) {
        process.stderr.write(`Команда заблокирована: ${rule.why}`);
        process.exit(2);
      }
    }
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(process.exitCode || 0));
