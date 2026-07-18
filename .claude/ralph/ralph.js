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
 *   issues кончились (фаза готова) — полный AFK-цикл сдачи:
 *     claude -p "создай PR" → claude -p "code review" (отдельная модель, блокеры→label blocked)
 *       → claude -p "правки по ревью" → детерминированный гейт (раннер сам: нет blocked +
 *       зелёные lint/lint:fsd/typecheck/test) → squash-merge → переход к следующей фазе.
 *     Гейт красный/blocked → PR оставлен человеку, loop стоп (следующая фаза зависима).
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
        return (
            JSON.parse(
                sh(
                    `gh issue list --milestone "${milestone}" --state open --json number,title,labels`,
                ),
            )
                // blocked = агент упёрся в ручной гейт (npm install и т.п.) — пропускаем,
                // чтобы AFK-цикл не сжигал итерации об одну стену; снимает label человек.
                .filter((i) => !(i.labels || []).some((l) => l.name === 'blocked'))
                .sort((a, b) => a.number - b.number)
        );
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
// а когда фаза принята: все issues разобраны И PR фазы смерджен.
// Свип на каждом старте раннера — закрывает хвосты прошлых фаз, в том числе
// уже выпавших из config.phases (для них PR ищется по заголовку
// «feat: <milestone>» — так его называет сам раннер при создании).

function closeCompletedMilestones() {
    let milestones = [];
    let mergedPrs = [];
    try {
        milestones = JSON.parse(sh('gh api "repos/{owner}/{repo}/milestones?state=open"'));
        mergedPrs = JSON.parse(
            sh('gh pr list --state merged --json title,headRefName --limit 100'),
        );
    } catch (e) {
        log(`⚠ Не смог получить данные для свипа milestones: ${e.message}`);
        return;
    }
    for (const ms of milestones) {
        if (ms.open_issues > 0 || ms.closed_issues === 0) continue;
        const phase = config.phases.find((p) => p.milestone === ms.title);
        const merged = mergedPrs.some((pr) =>
            phase ? pr.headRefName === phase.branch : pr.title === `feat: ${ms.title}`,
        );
        if (!merged) continue;
        try {
            sh(`gh api -X PATCH repos/{owner}/{repo}/milestones/${ms.number} -f state=closed`);
            log(`🏁 Milestone закрыт: "${ms.title}" (issues разобраны, PR смерджен)`);
        } catch (e) {
            log(`⚠ Не смог закрыть milestone "${ms.title}": ${e.message}`);
        }
    }
}

// ── AFK-гейт мерджа фазы ─────────────────────────────────────────────────────
// После PR → ревью → авто-правки раннер САМ проверяет качество (детерминированно,
// не доверяя агенту на слово): PR не помечен 'blocked' И зелёные все чеки.
// Зелёно → squash-merge, main обновляется, переход к следующей фазе (полный AFK).
// Красно / blocked / мердж не удался → PR оставлен человеку, loop останавливается.

const GATE_CHECKS = [
    ['lint', 'npm run lint'],
    ['lint:fsd', 'npm run lint:fsd'],
    ['typecheck', 'npm run typecheck'],
    ['test', 'npm run test --silent'],
];

function findOpenPr(branch) {
    try {
        const prs = JSON.parse(sh(`gh pr list --head ${branch} --state open --json number,labels`));
        return prs[0] || null;
    } catch (e) {
        log(`⚠ Не смог получить PR ветки ${branch}: ${e.message}`);
        return null;
    }
}

// Чеки прогоняются на коде ветки — переключаемся на неё. true только если ВСЕ зелёные.
function checksGreen(branch) {
    try {
        sh(`git checkout ${branch}`);
    } catch (e) {
        log(`⚠ Не смог переключиться на ${branch} для прогонки чеков: ${e.message}`);
        return false;
    }
    for (const [name, cmd] of GATE_CHECKS) {
        try {
            sh(cmd);
            log(`  ✓ ${name}`);
        } catch {
            log(`  ✗ ${name} — красный, авто-мердж отменён`);
            return false;
        }
    }
    return true;
}

// Фаза уже смерджена (авто-мерджем прошлого прогона ИЛИ вручную человеком)?
// Нужно, чтобы после ручного мерджа loop не зациклился на пересоздании PR, а
// просто перешёл к следующей фазе.
function phaseMerged(phase) {
    try {
        const merged = JSON.parse(
            sh(`gh pr list --head ${phase.branch} --state merged --json number --limit 1`),
        );
        return merged.length > 0;
    } catch (e) {
        log(`⚠ Не смог проверить мердж-статус ветки ${phase.branch}: ${e.message}`);
        return false;
    }
}

// Гейт мерджа фазы. true = смерджено и main обновлён; false = оставлено человеку.
function tryMergePhase(phase) {
    const pr = findOpenPr(phase.branch);
    if (!pr) {
        log(`⛔ Гейт: открытый PR ветки ${phase.branch} не найден — мердж невозможен.`);
        return false;
    }
    if ((pr.labels || []).some((l) => l.name === 'blocked')) {
        log(`⛔ Гейт: PR #${pr.number} помечен 'blocked' — оставлен человеку.`);
        return false;
    }
    if (!checksGreen(phase.branch)) {
        log(`⛔ Гейт: чеки красные на PR #${pr.number} — оставлен человеку.`);
        return false;
    }
    try {
        sh(`gh pr merge ${pr.number} --squash --delete-branch`);
        sh('git checkout main');
        sh('git pull --ff-only');
        log(`✅ PR #${pr.number} смерджен (squash), main обновлён.`);
        return true;
    } catch (e) {
        log(`⛔ Гейт: мердж PR #${pr.number} не удался (${e.message}) — оставлен человеку.`);
        return false;
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
    `🚀 Ralph start | mode=${ONCE ? 'HITL (1 итерация)' : 'AFK'} | dry=${DRY} | ${config.phases[state.phaseIndex]?.milestone ?? '—'} (${state.phaseIndex + 1}/${config.phases.length}), итерация ${state.count}`,
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
            `🔄 ${phase.milestone} | итерация ${state.count}/${maxIterations} | Issue #${next.number}: ${next.title} | модель: ${issueModel} | осталось: ${issues.length}`,
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
        // Фаза уже смерджена (авто- или вручную) — просто идём дальше, без пересоздания PR.
        if (phaseMerged(phase)) {
            log(`✅ Фаза "${phase.milestone}" уже смерджена — переход к следующей.`);
            state.phaseIndex++;
            state.count = 0;
            saveState(state);
            if (ONCE || DRY) break;
            continue;
        }

        log(`✅ Фаза "${phase.milestone}" — issues закрыты. PR → ревью → правки → гейт мерджа...`);

        // 1. PR (идемпотентно — не плодим дубликаты при рестарте).
        runClaude(
            `Если открытого PR из ветки ${phase.branch} в main ещё нет — создай его (заголовок: feat: ${phase.milestone}, в описании перечисли закрытые issues фазы и план тестирования). Если PR уже есть — ничего не создавай.`,
            { model: config.model, maxTurns: 30 },
        );

        // 2. Ревью отдельной моделью. Блокеры → label blocked на PR (гейт их поймает).
        const reviewModel = pickReviewModel(phase.milestone);
        if (reviewModel && reviewModel !== 'none') {
            log(`🔍 Ревью фазы моделью: ${reviewModel}`);
            runClaude(
                `Найди последний открытый PR из ветки ${phase.branch} и проведи детальное code review: архитектура, безопасность, производительность, соответствие PRD. Оставь комментарии в PR через gh cli. Если есть БЛОКИРУЮЩИЕ проблемы (баги, дыры безопасности, сломанная физика или сборка) — поставь на PR label blocked.`,
                { model: reviewModel, maxTurns },
            );
        } else {
            log('👀 Ревью PR — за супервизором (review: none).');
        }

        // 3. Авто-правки по ревью кодерской моделью фазы.
        log('🔧 Правки по ревью...');
        runClaude(
            `Прочитай комментарии code review в открытом PR ветки ${phase.branch}. Примени применимые правки (low/nit — где уместно; спорные помечай ответом-комментарием в PR), закоммить в ту же ветку со ссылкой на PR. Затем прогони npm run lint, npm run lint:fsd, npm run typecheck, npm run test и добейся зелёного. Если правку нельзя сделать автономно или тесты не удаётся починить — поставь на PR label blocked и опиши причину в комментарии.`,
            { model: config.model, maxTurns },
        );

        // 4. Детерминированный гейт: раннер сам проверяет blocked + чеки и мерджит.
        log('🚦 Гейт мерджа: проверка label blocked + прогон чеков...');
        if (tryMergePhase(phase)) {
            state.phaseIndex++;
            state.count = 0;
            saveState(state);
            if (ONCE || DRY) break;
            // continue → следующая фаза стартует с обновлённого main (полный AFK)
        } else {
            log(
                `⛔ Фаза "${phase.milestone}" не прошла авто-мердж — PR оставлен человеку. ` +
                    `Разберись/смерджи вручную, затем перезапусти loop.`,
            );
            break;
        }
    }
}

log('🏁 Ralph loop завершён.');
