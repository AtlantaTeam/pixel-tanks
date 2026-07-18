#!/usr/bin/env node
/**
 * PreCompact hook — backup session transcript before Claude Code compacts it.
 *
 * Input (stdin): JSON object with `transcript_path` field
 * Output: copies transcript file to .claude/backups/pre-compact-<timestamp>.jsonl
 *
 * Cross-platform Node API only.
 * Never throws — exit 0 always.
 */

const fs = require('node:fs');
const path = require('node:path');

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (chunk) => {
            data += chunk;
        });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(''));
        // Безопасный fallback если stdin не приходит
        setTimeout(() => resolve(data), 5000);
    });
}

function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return (
        d.getFullYear() +
        pad(d.getMonth() + 1) +
        pad(d.getDate()) +
        '_' +
        pad(d.getHours()) +
        pad(d.getMinutes()) +
        pad(d.getSeconds())
    );
}

async function main() {
    const raw = await readStdin();
    if (!raw) {
        process.stderr.write('[backup-transcript] empty stdin, skip\n');
        return;
    }

    let input;
    try {
        input = JSON.parse(raw);
    } catch (e) {
        process.stderr.write(`[backup-transcript] invalid JSON: ${e.message}\n`);
        return;
    }

    const transcriptPath = input.transcript_path;
    if (!transcriptPath || typeof transcriptPath !== 'string') {
        process.stderr.write('[backup-transcript] no transcript_path field\n');
        return;
    }

    if (!fs.existsSync(transcriptPath)) {
        process.stderr.write(
            `[backup-transcript] transcript not found: ${transcriptPath}\n`,
        );
        return;
    }

    const backupDir = path.join('.claude', 'backups');
    try {
        fs.mkdirSync(backupDir, { recursive: true });
    } catch (e) {
        process.stderr.write(
            `[backup-transcript] mkdir failed: ${e.message}\n`,
        );
        return;
    }

    const backupName = `pre-compact-${timestamp()}.jsonl`;
    const backupPath = path.join(backupDir, backupName);

    try {
        fs.copyFileSync(transcriptPath, backupPath);
        process.stderr.write(`[backup-transcript] saved: ${backupPath}\n`);
    } catch (e) {
        process.stderr.write(`[backup-transcript] copy failed: ${e.message}\n`);
    }
}

main()
    .catch((e) => {
        process.stderr.write(`[backup-transcript] error: ${e.message}\n`);
    })
    .finally(() => {
        process.exit(0);
    });
