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
const { resolveProfile, parseProfileFlag, pushEvent } = require('./ralph.js');
// Пороги тишины (#147): классификация хвоста лога по режиму + порог по режиму. Здесь
// (в мониторе) — импёровая половина: чтение файла, «сейчас» и сравнение с порогом.
const { classifyActivity, silenceThresholdMs } = require('./deadman.js');

const RALPH_DIR = __dirname;
const REPO_DIR = path.resolve(RALPH_DIR, '..', '..');
const LOG_PATH = path.join(RALPH_DIR, 'ralph.log');
const STATE_PATH = path.join(RALPH_DIR, 'ralph.state.json');

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const intervalIdx = args.indexOf('--interval');
const INTERVAL_SEC = intervalIdx !== -1 ? Number(args[intervalIdx + 1]) || 300 : 300;
// --config <путь> (#SiaT8): раннер прокидывает АБСОЛЮТНЫЙ путь конфига из дерева
// человека — тот же файл, по которому он реально идёт. Без флага (ручной запуск) —
// копия в этом же worktree; она может отставать на детач-коммите, о чём и был ревью.
const configIdx = args.indexOf('--config');
const CONFIG_PATH =
    configIdx !== -1 && args[configIdx + 1]
        ? args[configIdx + 1]
        : path.join(RALPH_DIR, 'ralph.config.json');
// Профиль тем же парсером, что у раннера (раннер прокидывает его при авто-спавне).
// failFn → null: монитор наблюдательный, кривой флаг для него повод показать
// defaultProfile, а не упасть с панелью.
const PROFILE = parseProfileFlag(args, () => null);

// Строки лога, которые считаем «значимыми» (маркеры этапов AFK-цикла).
const SIGNAL_RE = /🚀|🔄|✅|🔍|🔧|🛑|⛔|🏁|❌|⚠|🔀|💤|🔔/u;

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

// Длительность без «назад» — для печати порога.
function fmtDur(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}м`;
    return `${Math.floor(m / 60)}ч ${m % 60}м`;
}

// Сырой хвост лога (НЕ отфильтрованный по SIGNAL_RE) + время последней записи. deadman
// классифицирует режим по маркерам ✓/✗/🚦, которых нет в SIGNAL_RE, поэтому детект
// читает сырые строки, а панель значимые получает фильтром signalTail поверх этого же
// чтения (одно чтение на тик). lastMtime = mtime файла: свежесть
// лога и есть признак жизни петли (log() пишется на каждом шаге хореографии). logPath
// параметром — чтобы тестировать на временном файле, а не только на боевом LOG_PATH.
function readLogTail(n = 200, logPath = LOG_PATH) {
    let raw;
    try {
        raw = fs.readFileSync(logPath, 'utf8');
    } catch {
        return { lines: [], lastMtime: null };
    }
    let lastMtime = null;
    try {
        lastMtime = fs.statSync(logPath).mtimeMs;
    } catch {
        /* ignore */
    }
    return { lines: raw.split('\n').slice(-n), lastMtime };
}

// Детект тишины: возраст последней записи лога (now − lastMtime) против порога режима
// текущего шага (coder до 2ч, гейт/хоз-шаги — минуты). Чистая функция — все входы
// аргументами, «сейчас» приходит извне: детект смотрит на ФАЙЛ, а не на процесс
// раннера, поэтому переживает его смерть (kill -9, OOM). Сам пуш и дедуп — #149.
function evalDeadman({ now, lastMtime, lines, config }) {
    if (lastMtime == null) {
        return {
            silent: false,
            reason: 'no-log',
            activity: null,
            thresholdMs: null,
            silenceMs: null,
        };
    }
    const activity = classifyActivity(lines);
    // lines прокидываем — режиму apiwait порог берётся из строки паузы `Жду N мин`.
    const thresholdMs = silenceThresholdMs(activity, config, lines);
    // Math.max(0, …): mtime снимается ПОСЛЕ чтения контента, а now — до обоих. Запись в
    // лог между этими точками (или скачок системных часов назад) дала бы lastMtime > now
    // → отрицательный silenceMs и косметический `⏱ лог -1с назад`. Зажимаем в ноль.
    const silenceMs = Math.max(0, now - lastMtime);
    return { silent: silenceMs > thresholdMs, reason: null, activity, thresholdMs, silenceMs };
}

// Дедуп повторных пушей об одной и той же тишине (#149 — alert fatigue главный риск
// по PRD). Эпизод тишины идентифицируем по lastMtime — моменту, когда лог перестал
// расти: пока файл не сдвинулся дальше, это ТА ЖЕ тишина, повторный пуш не нужен. Как
// только лог снова пишется (loop ожил или человек вмешался), lastMtime меняется —
// следующая тишина, если наступит, будет уже новым эпизодом со своим ключом.
function shouldPushDeadman(deadman, lastMtime, lastPushedForMtime) {
    return deadman.silent && lastMtime !== lastPushedForMtime;
}

// Текст пуша — та же формулировка, что и на панели (evalDeadman/fmtAge/fmtDur), плюс
// имя фазы и явное «цикл не остановлен» — по PRD автостоп не делаем, ложный ночной
// стоп дороже лишнего пуша, и человек должен понимать, что раннер продолжит идти.
function deadmanPushMessage(deadman, milestoneName) {
    return (
        `💀 Ralph: DEADMAN на фазе "${milestoneName}" — лог молчит ${fmtAge(deadman.silenceMs)}, ` +
        `дольше порога ${fmtDur(deadman.thresholdMs)} (режим ${deadman.activity}). ` +
        'Цикл продолжается без остановки — проверь вручную.'
    );
}

// Оценка + сам пуш, вынесено из snapshot(), чтобы тестировать без реальных gh-вызовов
// остального снапшота — тот же приём, что evalDeadman/readLogTail (#147/#148): чистая
// логика решения отдельно от побочек панели. pushFn инжектируется (как pushEventFn в
// ralph.js) — тесты мокают сам вызов, не profileName/Telegram. Возвращает новый ключ
// дедупа (вызывающий код держит его в состоянии между тиками).
// logFn у pushFn — НЕ log() раннера: та функция дописывает СТРОКУ В ТОТ ЖЕ ralph.log,
// по свежести которого детект и определяет тишину. Если бы пуш писал туда же,
// lastMtime «ожил» бы от собственного пуша монитора, и реальная тишина маскировалась
// бы навсегда (мёртвый раннер выглядел бы живым из-за пуша про его смерть). Печатаем
// в свой stdout — monitor.out, куда и так льётся вся панель, tail -f видит и его.
function maybePushDeadman(
    deadman,
    lastMtime,
    lastPushedForMtime,
    { pushFn = pushEvent, cfg, milestoneName } = {},
) {
    if (!shouldPushDeadman(deadman, lastMtime, lastPushedForMtime)) {
        return lastPushedForMtime;
    }
    // Кривой/нечитаемый конфиг (resolveProfile → null): в prod pushEvent молча вернёт
    // false ДО доставки, то есть деадман обезоружен ровно в аварийном состоянии, о
    // котором watchdog и должен кричать. Fail-safe-доставка при null-конфиге — фаза 2;
    // здесь минимум — раз на эпизод явно предупредить в свой stdout (monitor.out).
    if (!cfg) {
        console.log(
            '⚠ Ralph deadman: конфиг не резолвится — deadman-пуши НЕ доставляются (проверь ralph.config.json / --profile).',
        );
    }
    const delivered = pushFn(deadmanPushMessage(deadman, milestoneName), cfg, {
        logFn: console.log,
    });
    // Дедуп-ключ защёлкиваем не безусловно: в prod false у pushEvent = доставка НЕ удалась
    // (сбой curl/сети/Telegram, fail-open вернул false) — единственный алерт о мёртвом
    // ночном раннере нельзя терять, поэтому ключ НЕ двигаем, следующий тик повторит.
    // В non-prod/при null-конфиге false = пуш штатно подавлен профилем (доставки нет и не
    // будет) — тогда защёлкиваем, иначе наивный ретрай спамил бы monitor.out каждый тик.
    const deliveryAttempted = !!cfg && cfg.profileName === 'prod';
    if (deliveryAttempted && !delivered) {
        return lastPushedForMtime;
    }
    return lastMtime;
}

// Значимые строки (маркеры этапов) из УЖЕ прочитанного хвоста — последние n. Своего
// чтения файла НЕ делает: и панель значимых строк, и детект тишины идут от одного
// readLogTail в snapshot(). Так у тика ровно одно чтение (растущий многодневный лог не
// читается дважды за тик) и ровно один mtime — иначе два независимых statSync могли бы
// разойтись, и возраст одного файла в строках `🟢 активен` и `⏱ лог` показал бы разное.
function signalTail(lines, n) {
    return lines.filter((l) => SIGNAL_RE.test(l)).slice(-n);
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

// Ключ дедупа деадмана (#149) — переживает между тиками setInterval (тот же процесс
// monitor.js на весь прогон петли), но НЕ переживает перезапуск самого монитора: это
// уже фаза 2 (взаимный контроль раннер↔монитор), здесь не в скоупе.
let lastDeadmanPushMtime = null;

function snapshot() {
    const now = Date.now();
    const state = readJSON(STATE_PATH) || {};
    // Конфиг профильный (#71) — phases лежат в common, поэтому резолвим тем же кодом,
    // что и раннер, а не читаем сырой JSON. failFn → null: монитор наблюдательный,
    // кривой конфиг для него повод показать «—», а не упасть (упасть должен ralph.js).
    const config = resolveProfile(readJSON(CONFIG_PATH), PROFILE, () => null);
    // Одно чтение лога на тик — источник правды и для панели, и для детекта. readLogTail
    // отдаёт весь хвост (n=Infinity) и ОДИН mtime: от него и признак жизни (alive), и
    // детект тишины, и последние значимые строки. Детект смотрит сырой хвост (маркеры
    // ✓/✗/🚦 в SIGNAL_RE не попадают), панель — только значимые (signalTail). Сам пуш о
    // тишине и дедуп — #149; здесь только детект и его показ.
    const { lines: allLogLines, lastMtime } = readLogTail(Infinity);
    const lines = signalTail(allLogLines, 8);
    const deadman = evalDeadman({
        now,
        lastMtime,
        lines: allLogLines.slice(-200),
        config,
    });
    const ms = currentMilestone(state, config);
    const milestoneName = ms?.phase?.milestone || state.milestone || '—';
    // Пуш о тишине (#149): только доставка события, цикл раннера монитор не трогает —
    // он вообще не властен над ним, у монитора нет доступа к процессу сессии/loop.
    lastDeadmanPushMtime = maybePushDeadman(deadman, lastMtime, lastDeadmanPushMtime, {
        cfg: config,
        milestoneName,
    });
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
    if (deadman.reason !== 'no-log') {
        out.push(
            deadman.silent
                ? `  💀 DEADMAN: лог молчит ${fmtAge(deadman.silenceMs)} — дольше порога ${fmtDur(deadman.thresholdMs)} (режим ${deadman.activity})`
                : `  ⏱  лог ${fmtAge(deadman.silenceMs)}, порог тишины ${fmtDur(deadman.thresholdMs)} (режим ${deadman.activity})`,
        );
    }
    out.push(`╚${bar}╝`);
    out.push(
        `Фаза: ${milestoneName}` +
            (ms && ms.idx !== -1 ? `  (${ms.idx + 1}/${ms.total})` : '') +
            `   submitted=${state.submitted ? 'да' : 'нет'}   iter=${state.count ?? '?'}`,
    );
    out.push(`git: ${branch} @ ${head}`);
    // Профиль и статус доставки пушей. Операционный шов: ручной перезапуск монитора без
    // --profile берёт defaultProfile (playground) — и на prod-хосте deadman-пуши молча не
    // доставляются (pushEvent шлёт только в prod). Именно ручной рестарт после смерти
    // монитора — аварийный сценарий, где watchdog нужнее всего, поэтому статус доставки
    // виден в панели, а не молча выключен. null-конфиг → доставки тоже нет (см. maybePush).
    const deliveryOn = !!config && config.profileName === 'prod';
    out.push(
        `профиль: ${config?.profileName || '—'}   доставка пушей: ${deliveryOn ? 'вкл' : 'выкл (только prod)'}`,
    );

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

// Экспорт чистых частей детекта — для тестов (#147/#148) и пуша с дедупом (#149).
// Гейт require.main === module: при импорте из теста НЕ запускаем панель (gh-запросы,
// setInterval), выполняются только объявления, как и с require('./ralph.js') выше.
module.exports = {
    evalDeadman,
    readLogTail,
    fmtDur,
    fmtAge,
    shouldPushDeadman,
    deadmanPushMessage,
    maybePushDeadman,
};

if (require.main === module) main();
