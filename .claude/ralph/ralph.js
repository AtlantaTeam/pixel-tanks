#!/usr/bin/env node
/**
 * Ralph Loop — автономный цикл разработки поверх GitHub Issues.
 *
 * Архитектура: ВНЕШНИЙ цикл (улучшение относительно курсового Stop-hook варианта,
 * где каждая итерация запускала claude внутри хука предыдущей — вложенные процессы,
 * невосстановимое состояние при падении). Здесь раннер сам крутит while-loop:
 *
 *   пока есть открытые issues в milestone фазы:
 *     claude -p "возьми следующий issue и реализуй"     (1 issue = 1 сессия = чистый контекст)
 *   issues кончились:
 *     claude -p "создай PR"  →  claude -p "проведи code review" (отдельная модель)
 *     переход к следующей фазе
 *
 * Circuit breaker: maxIterations (на фазу), maxTurns (на сессию),
 * maxTestAttempts — в ralph.md как правило для агента.
 *
 * Запуск:
 *   node .claude/ralph/ralph.js            AFK: до maxIterations итераций
 *   node .claude/ralph/ralph.js --once     HITL: одна итерация и стоп
 *   node .claude/ralph/ralph.js --dry-run  показать что будет сделано, ничего не запуская
 *   node .claude/ralph/ralph.js --reset    сбросить счётчики (state-файл)
 *
 * Требования: gh CLI авторизован, git-репозиторий, ralph.config.json настроен, active: true.
 */

const { execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CLAUDE_DIR = '.claude';
const CONFIG_PATH = path.join(CLAUDE_DIR, 'ralph', 'ralph.config.json');
const STATE_PATH = path.join(CLAUDE_DIR, 'ralph', 'ralph.state.json');
const LOG_PATH = path.join(CLAUDE_DIR, 'ralph', 'ralph.log');

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const DRY = args.includes('--dry-run');
const RESET = args.includes('--reset');

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try {
        fs.appendFileSync(LOG_PATH, line + '\n');
    } catch {}
}

function fail(msg) {
    console.error(`❌ ${msg}`);
    process.exit(1);
}

function sh(cmd) {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function loadJson(p, fallback) {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
        return fallback;
    }
}

function saveState(state) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/** Запуск claude -p. Prompt не должен содержать двойных кавычек. */
function runClaude(prompt, { model, maxTurns }) {
    if (/"/.test(prompt)) fail('Prompt содержит двойные кавычки — упрости формулировку.');
    const extra =
        (config.permissionMode ? ` --permission-mode ${config.permissionMode}` : '') +
        (config.fallbackModel ? ` --fallback-model ${config.fallbackModel}` : '');
    const cmd = `claude -p "${prompt}" --max-turns ${maxTurns}${model ? ` --model ${model}` : ''}${extra}`;
    log(`▶ ${cmd.slice(0, 160)}...`);
    if (DRY) return;
    const res = spawnSync(cmd, { stdio: 'inherit', shell: true });
    if (res.status !== 0)
        log(
            `⚠ claude завершился с кодом ${res.status} — продолжаем (issue мог быть закрыт частично)`,
        );
}

function openIssues(milestone) {
    try {
        // gh отдаёт новые-первыми; порядок работы — по возрастанию номера (порядок задач в плане)
        return JSON.parse(
            sh(`gh issue list --milestone "${milestone}" --state open --json number,title,labels`),
        ).sort((a, b) => a.number - b.number);
    } catch (e) {
        fail(
            `gh issue list упал: ${e.message}\nПроверь: gh auth status, milestone "${milestone}" существует.`,
        );
    }
}

// ── Роутинг моделей по сложности ─────────────────────────────────────────────
// Issue помечается одним label complexity:{low|medium|high|expert}.
// Кодер: label → модель из config.modelRouting.labels (haiku/sonnet/opus/fable).
// Ревью фазы: config.review.default (opus), но если в фазе был хоть один issue
// с label из config.review.escalateOn — эскалация на config.review.escalated (fable).

const COMPLEXITY_PRIORITY = [
    'complexity:expert',
    'complexity:high',
    'complexity:medium',
    'complexity:low',
];

function pickModel(issue) {
    const routing = config.modelRouting;
    if (!routing || !routing.labels) return config.model;
    const names = (issue.labels || []).map((l) => l.name);
    for (const label of COMPLEXITY_PRIORITY) {
        if (names.includes(label) && routing.labels[label]) return routing.labels[label];
    }
    return routing.default || config.model;
}

function pickReviewModel(milestone) {
    const review = config.review;
    if (!review) return config.reviewModel; // легаси-конфиг без блока review
    const escalateOn = review.escalateOn || [];
    let all = [];
    try {
        all = JSON.parse(
            sh(`gh issue list --milestone "${milestone}" --state all --json labels --limit 100`),
        );
    } catch (e) {
        log(`⚠ Не смог получить labels фазы для выбора ревью-модели: ${e.message}`);
    }
    const hasComplex = all.some((i) => (i.labels || []).some((l) => escalateOn.includes(l.name)));
    return hasComplex ? review.escalated : review.default;
}

// ── Закрытие milestones ──────────────────────────────────────────────────────
// Milestone закрывается НЕ при создании PR (ревью может вернуть работу),
// а когда фаза принята: все issues разобраны И PR ветки фазы смерджен.
// Свип на каждом старте раннера — закрывает хвосты прошлых фаз.

function closeCompletedMilestones() {
    let milestones = [];
    try {
        milestones = JSON.parse(sh('gh api "repos/{owner}/{repo}/milestones?state=open"'));
    } catch (e) {
        log(`⚠ Не смог получить milestones для свипа: ${e.message}`);
        return;
    }
    for (const phase of config.phases) {
        const ms = milestones.find((m) => m.title === phase.milestone);
        if (!ms || ms.open_issues > 0) continue;
        let merged = false;
        try {
            merged =
                JSON.parse(
                    sh(`gh pr list --head ${phase.branch} --state merged --json number --limit 1`),
                ).length > 0;
        } catch (e) {
            log(`⚠ Не смог проверить PR ветки ${phase.branch}: ${e.message}`);
        }
        if (!merged) continue;
        try {
            sh(`gh api -X PATCH repos/{owner}/{repo}/milestones/${ms.number} -f state=closed`);
            log(`🏁 Milestone закрыт: "${phase.milestone}" (issues разобраны, PR смерджен)`);
        } catch (e) {
            log(`⚠ Не смог закрыть milestone "${phase.milestone}": ${e.message}`);
        }
    }
}

// ── Preflight ────────────────────────────────────────────────────────────────

const config = loadJson(CONFIG_PATH, null);
if (!config) fail(`Не найден/не парсится ${CONFIG_PATH}`);

if (RESET) {
    saveState({ count: 0, phaseIndex: 0 });
    console.log('✅ Счётчики сброшены.');
    process.exit(0);
}

if (!config.active)
    fail('ralph.config.json: active=false. Включи осознанно (это автономный запуск).');
if (!Array.isArray(config.phases) || config.phases.length === 0) fail('В конфиге нет phases.');

try {
    sh('git rev-parse --is-inside-work-tree');
} catch {
    fail('Не git-репозиторий.');
}
try {
    sh('gh auth status');
} catch {
    fail('gh CLI не авторизован (gh auth login).');
}
const dirty = sh('git status --porcelain');
if (dirty && !DRY) {
    fail('Рабочее дерево грязное — закоммить или застэшь перед автономным запуском:\n' + dirty);
}

if (!DRY) closeCompletedMilestones();

const maxIterations = ONCE ? 1 : config.maxIterations || 10;
const maxTurns = config.maxTurns || 200;
const state = loadJson(STATE_PATH, { count: 0, phaseIndex: 0 });
// HITL: лимит «1 итерация» отсчитывается от этого запуска, накопленный счётчик
// AFK-прогонов не должен превращать запуск в холостой сброс через circuit breaker.
if (ONCE) state.count = 0;

log(
    `🚀 Ralph start | mode=${ONCE ? 'HITL (1 итерация)' : 'AFK'} | dry=${DRY} | фаза ${state.phaseIndex + 1}/${config.phases.length}, итерация ${state.count}`,
);

// ── Main loop ────────────────────────────────────────────────────────────────

while (true) {
    const phase = config.phases[state.phaseIndex];
    if (!phase) {
        log('🎉 Все фазы завершены!');
        break;
    }

    if (state.count >= maxIterations) {
        log(
            `⛔ Circuit breaker: лимит итераций (${maxIterations}) на фазу "${phase.milestone}". Проверь лог и issues, перезапусти для продолжения.`,
        );
        state.count = 0;
        saveState(state);
        break;
    }

    const issues = openIssues(phase.milestone);

    if (issues.length > 0) {
        state.count++;
        if (!DRY) saveState(state);
        const next = issues[0];
        const issueModel = pickModel(next);
        log(
            `🔄 Фаза ${state.phaseIndex + 1} | итерация ${state.count}/${maxIterations} | Issue #${next.number}: ${next.title} | модель: ${issueModel} | осталось: ${issues.length}`,
        );

        const prompt = (config.prompt || '')
            .replace('{milestone}', phase.milestone)
            .replace('{branch}', phase.branch);
        runClaude(prompt, { model: issueModel, maxTurns });

        if (ONCE) {
            log('✋ HITL: одна итерация выполнена, стоп. Проверь результат и запусти снова.');
            break;
        }
        if (DRY) break;
    } else {
        log(`✅ Фаза "${phase.milestone}" завершена (открытых issues нет). PR + review...`);

        runClaude(
            `Создай PR из ветки ${phase.branch} в main. Заголовок: feat: ${phase.milestone}. В описании перечисли закрытые issues этой фазы и план тестирования.`,
            { model: config.model, maxTurns: 30 },
        );
        const reviewModel = pickReviewModel(phase.milestone);
        if (reviewModel && reviewModel !== 'none') {
            log(`🔍 Ревью фазы моделью: ${reviewModel}`);
            runClaude(
                `Найди последний открытый PR из ветки ${phase.branch} и проведи детальное code review: архитектура, безопасность, производительность, соответствие PRD. Оставь комментарии в PR через gh cli.`,
                { model: reviewModel, maxTurns },
            );
        } else {
            log('👀 Ревью PR — за супервизором (review: none).');
        }

        state.phaseIndex++;
        state.count = 0;
        saveState(state);

        if (ONCE || DRY) break;
    }
}

log('🏁 Ralph loop завершён.');
