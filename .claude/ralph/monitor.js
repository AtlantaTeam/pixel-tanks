#!/usr/bin/env node
/*
 * Ralph monitor — панель прогресса AFK-цикла.
 *
 * Каждые N секунд (по умолчанию 300 = 5 минут) печатает сводку:
 *   - жив ли loop (по свежести ralph.log)
 *   - текущая фаза / submitted (из ralph.state.json)
 *   - прогресс issues текущего milestone (gh)
 *   - открытые PR игры game-next (gh)
 *   - последние значимые строки ralph.log (маркеры фаз/итераций/ревью/мерджа)
 *
 * Использование:
 *   node .claude/ralph/monitor.js              # цикл каждые 5 мин
 *   node .claude/ralph/monitor.js --once       # разовый снимок и выход
 *   node .claude/ralph/monitor.js --interval 60   # свой интервал (сек)
 *
 * Только чтение: gh-запросы + чтение файлов. Ничего не мутирует.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
// Резолв профилей (#71) — единый источник правды с раннером, чтобы монитор не завёл
// вторую копию правил мерджа. require безопасен: main() в ralph.js под guard
// require.main === module, при импорте выполняются только объявления и консты.
const { resolveProfile } = require('./ralph.js');

const RALPH_DIR = __dirname;
const REPO_DIR = path.resolve(RALPH_DIR, '..', '..');
const LOG_PATH = path.join(RALPH_DIR, 'ralph.log');
const STATE_PATH = path.join(RALPH_DIR, 'ralph.state.json');
const CONFIG_PATH = path.join(RALPH_DIR, 'ralph.config.json');

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const intervalIdx = args.indexOf('--interval');
const INTERVAL_SEC = intervalIdx !== -1 ? Number(args[intervalIdx + 1]) || 300 : 300;

// Строки лога, которые считаем «значимыми» (маркеры этапов AFK-цикла).
const SIGNAL_RE = /🚀|🔄|✅|🔍|🔧|🛑|⛔|🏁|❌|⚠|🔀|💤/u;

function sh(cmd) {
    try {
        return execSync(cmd, {
            cwd: REPO_DIR,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return '';
    }
}

function readJSON(p) {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
        return null;
    }
}

function fmtAge(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}с назад`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}м ${s % 60}с назад`;
    const h = Math.floor(m / 60);
    return `${h}ч ${m % 60}м назад`;
}

function tailSignals(n) {
    let raw;
    try {
        raw = fs.readFileSync(LOG_PATH, 'utf8');
    } catch {
        return { lines: [], lastMtime: null };
    }
    const lines = raw.split('\n').filter((l) => SIGNAL_RE.test(l));
    let lastMtime = null;
    try {
        lastMtime = fs.statSync(LOG_PATH).mtimeMs;
    } catch {
        /* ignore */
    }
    return { lines: lines.slice(-n), lastMtime };
}

function currentMilestone(state, config) {
    // state.milestone может быть точным именем фазы; сверяем с конфигом,
    // чтобы понять индекс/ветку.
    if (!config || !Array.isArray(config.phases)) return null;
    const idx = config.phases.findIndex((p) => p.milestone === state?.milestone);
    return {
        idx,
        phase: idx !== -1 ? config.phases[idx] : null,
        total: config.phases.length,
    };
}

function issuesProgress(milestone) {
    if (!milestone) return null;
    // gh поддерживает поиск по milestone имени.
    const open = sh(
        `gh issue list --milestone "${milestone}" --state open --json number --jq "length"`,
    );
    const closed = sh(
        `gh issue list --milestone "${milestone}" --state closed --json number --jq "length"`,
    );
    if (open === '' && closed === '') return null;
    const o = Number(open) || 0;
    const c = Number(closed) || 0;
    return { open: o, closed: c, total: o + c };
}

function openGamePRs() {
    const out = sh(
        `gh pr list --state open --search "head:feature/phase-" --json number,title,headRefName,mergeStateStatus,reviewDecision --jq "."`,
    );
    if (!out) return [];
    try {
        return JSON.parse(out);
    } catch {
        return [];
    }
}

function snapshot() {
    const now = Date.now();
    const state = readJSON(STATE_PATH) || {};
    // Конфиг профильный (#71) — phases лежат в common, поэтому резолвим тем же кодом,
    // что и раннер, а не читаем сырой JSON. failFn → null: монитор наблюдательный,
    // кривой конфиг для него повод показать «—», а не упасть (упасть должен ralph.js).
    const config = resolveProfile(readJSON(CONFIG_PATH), null, () => null);
    const { lines, lastMtime } = tailSignals(8);
    const ms = currentMilestone(state, config);
    const milestoneName = ms?.phase?.milestone || state.milestone || '—';
    const prog = issuesProgress(milestoneName);
    const prs = openGamePRs();
    const head = sh('git rev-parse --short HEAD');
    const branch = sh('git rev-parse --abbrev-ref HEAD');

    const alive =
        lastMtime != null && now - lastMtime < INTERVAL_SEC * 1000 * 3
            ? `🟢 активен (лог ${fmtAge(now - lastMtime)})`
            : lastMtime != null
              ? `🟡 тихо (лог ${fmtAge(now - lastMtime)})`
              : '⚪ лог не найден';

    const bar = '═'.repeat(64);
    const out = [];
    out.push('');
    out.push(`╔${bar}╗`);
    out.push(`  RALPH MONITOR   ${new Date(now).toLocaleString('ru-RU')}`);
    out.push(`  ${alive}`);
    out.push(`╚${bar}╝`);
    out.push(
        `Фаза: ${milestoneName}` +
            (ms && ms.idx !== -1 ? `  (${ms.idx + 1}/${ms.total})` : '') +
            `   submitted=${state.submitted ? 'да' : 'нет'}   iter=${state.count ?? '?'}`,
    );
    out.push(`git: ${branch} @ ${head}`);

    if (prog) {
        const pct = prog.total ? Math.round((prog.closed / prog.total) * 100) : 0;
        const filled = Math.round((pct / 100) * 20);
        const gauge = '█'.repeat(filled) + '░'.repeat(20 - filled);
        out.push(
            `Issues: [${gauge}] ${prog.closed}/${prog.total} закрыто (${pct}%)  открыто: ${prog.open}`,
        );
    } else {
        out.push('Issues: (нет данных gh по milestone)');
    }

    if (prs.length) {
        out.push('Открытые PR фаз:');
        for (const pr of prs) {
            out.push(
                `  #${pr.number} ${pr.headRefName}  merge=${pr.mergeStateStatus || '?'}  review=${pr.reviewDecision || '—'}`,
            );
            out.push(`     ${pr.title}`);
        }
    } else {
        out.push('Открытые PR фаз: нет');
    }

    out.push('Лог (последние события):');
    if (lines.length) {
        for (const l of lines) out.push(`  ${l.slice(0, 160)}`);
    } else {
        out.push('  (пусто)');
    }
    out.push('');
    console.log(out.join('\n'));
}

function main() {
    snapshot();
    if (ONCE) return;
    console.log(`⏱  Обновление каждые ${INTERVAL_SEC}с. Ctrl+C для выхода.`);
    setInterval(snapshot, INTERVAL_SEC * 1000);
}

main();
