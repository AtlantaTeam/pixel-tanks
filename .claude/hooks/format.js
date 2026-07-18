#!/usr/bin/env node
/**
 * PostToolUse hook (matcher: Write|Edit) — автоформатирование через Prettier.
 *
 * Кроссплатформенная замена курсового варианта на jq+bash (не работал на Windows).
 *
 * Input (stdin): JSON { tool_input: { file_path }, tool_response: { filePath } }
 * Форматирует только файлы поддерживаемых расширений; молча пропускает всё остальное.
 * Never throws — exit 0 always (форматирование не должно ломать работу агента).
 */

const { execSync } = require('node:child_process');
const path = require('node:path');

const FORMATTABLE = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.css', '.scss', '.md', '.html', '.yml', '.yaml',
]);

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

async function main() {
  const raw = await readStdin();
  if (!raw) return;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  const file =
    (input.tool_input && input.tool_input.file_path) ||
    (input.tool_response && input.tool_response.filePath);
  if (!file) return;

  if (!FORMATTABLE.has(path.extname(file).toLowerCase())) return;

  try {
    execSync(`npx --no-install prettier --write "${file}"`, {
      stdio: 'ignore',
      timeout: 15000,
    });
  } catch {
    // prettier не установлен или файл вне проекта — молча пропускаем
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
