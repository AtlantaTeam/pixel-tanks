// Deadman — пороги тишины по последнему событию лога (#147).
//
// Признак жизни петли — время последней записи в ralph.log worktree. log() пишется
// на каждом шаге хореографии, поэтому свежесть лога = «раннер шевелится». Отдельный
// heartbeat-файл не нужен, смена HEAD отклонена (легитимные шаги ревью/гейта подолгу
// не двигают HEAD) — см. docs/ralph-reliability/prd.md, раздел «В скоупе» п.1.
//
// Общий порог тишины невозможен: claude-сессия (кодер-итерация, ревью, правки,
// создание PR, разбор blocked — все идут через runClaude → spawnSync) легитимно
// молчит до claudeTimeoutMs (2ч), а гейт и git/gh-шаги — минуты. Поэтому порог
// зависит от того, в каком РЕЖИМЕ сейчас петля, а режим определяется по последнему
// значимому маркеру в хвосте лога.
//
// Этот модуль — чистое правило (строки/числа на вход-выход): классификация хвоста и
// арифметика порога. Чтение файла, сравнение с «сейчас», дедуп и сам пуш — забота
// монитора (#148/#149). Побочек нет — DI и guardSideEffect не нужны.
//
// ── Числа порогов (замер реальных прогонов фаз 4–5, .claude/ralph/ralph.log) ──
// Кодер-сессии (🔄 → следующий шаг): реальный максимум ~21 мин (фаза 3, итерация 1),
//   типично 6–16 мин. Но легитимный ПОТОЛОК сессии — claudeTimeoutMs (2ч): spawnSync
//   держит claude ровно столько, поэтому порог = claudeTimeoutMs + запас, а не по
//   замеру. Замер лишь подтверждает: реальные сессии ≪ 2ч, ложных пушей не будет.
//   Запас (iterationGraceMs=10 мин) кроет kill по таймауту + запись результата + такт
//   опроса монитора на небыстром VDS. API-лимитные паузы внутри runClaude тишину не
//   создают: каждая пишет 🔔 PUSH ⏳ и сбрасывает счётчик, оставаясь в режиме coder.
// Гейт (🚦 → между строками ✓/✗ чеков): checksGreen логирует каждый чек, поэтому
//   тишина внутри гейта ограничена САМЫМ ДОЛГИМ одиночным чеком. Замер сейчас на этом
//   дереве: build ~36с, coverage ~19с, e2e (Playwright, prod-профиль) ~108с — самый
//   долгий. Плюс первый интервал 🚦→✓build кроет git fetch/detach и возможный npm ci
//   при смене lock (до ~2–3 мин). gateSilenceMs=10 мин даёт ~×3 запас над e2e и кроет
//   npm ci-путь на медленном VDS. Значение одно на оба профиля — под ХУДШИЙ (prod с
//   e2e); playground-гейт быстрее, ложных пушей тем более не даст.
// Дефолт (git/gh-шаги, обновление worktree, закрытие milestone): секунды; худшее —
//   стартовый npm ci нового worktree (~1–2 мин). defaultSilenceMs=5 мин с запасом.

// Маркеры claude-сессии: старт сессии (▶ claude -p логируется перед каждой) плюс
// шаговые эмодзи — итерация/ревью/правки. Любого достаточно, чтобы понять «идёт
// многочасовая сессия».
const CODER_RE = /▶ claude -p|🔄|🔍 Ревью|🔧 Правки/u;
// Маркеры гейта: старт (🚦) и строки результата отдельных чеков (checksGreen пишет
// `  ✓ name` / `  ✗ name — красный`). Якорь на начало не ставим: log() префиксит
// строку таймстампом, ✓/✗ идёт в середине. ✓/✗ — U+2713/U+2717, это НЕ ✅ U+2705 из
// completion-маркеров.
const GATE_RE = /🚦|[✓✗]\s/u;
// Маркеры завершения/остановки/старта — закрывают предыдущий режим и переводят в
// короткий дефолт: мердж (✅ PR), сдача фазы/туннель (✅), закрытие milestone (🏁),
// стопы (⛔/✋), баннер старта (🚀), переключение веток (🔀).
const DEFAULT_RE = /✅|🏁|⛔|✋|🚀|🔀/u;

// Дефолты порогов (мс) — если в ralph.config.json нет блока deadman. Совпадают с
// числами в конфиге; здесь — чтобы модуль работал и на «голом» конфиге (fail-safe).
const DEFAULT_DEADMAN = {
    iterationGraceMs: 10 * 60 * 1000, // запас поверх claudeTimeoutMs для кодер-сессии
    gateSilenceMs: 10 * 60 * 1000, // тишина внутри гейта (самый долгий чек + запас)
    defaultSilenceMs: 5 * 60 * 1000, // короткий дефолт для git/gh-шагов
};

const DEFAULT_CLAUDE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // как в runClaudeOnce (ralph.js)

// Режим петли по хвосту лога. Скан от последней строки к первой; возвращаем режим
// первой встреченной ЗНАЧИМОЙ строки (coder/gate/default-маркер). Нейтральные строки
// (⚠, ⏳, многострочные хвосты ошибок без маркера) пропускаем — они не меняют режим,
// иначе стрелой ⚠ посреди сессии режим упал бы в default и короткий порог дал бы
// ложный пуш. Смещение к «coder при неоднозначности» осознанно: лишний пуш дешевле
// пропущенной тишины, а PRD требует ноль ложных пушей на живом прогоне.
function classifyActivity(lines) {
    for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (typeof l !== 'string') continue;
        if (CODER_RE.test(l)) return 'coder';
        if (GATE_RE.test(l)) return 'gate';
        if (DEFAULT_RE.test(l)) return 'default';
        // прочее — нейтрально, продолжаем скан к более раннему маркеру
    }
    return 'default';
}

// Секция deadman и claudeTimeoutMs. Принимаем и уже резолвнутый профилем конфиг
// (поля на верхнем уровне, как отдаёт resolveProfile), и сырой с { common } — чтобы
// монитор мог звать до или после резолва, не гадая.
function readCfg(cfg) {
    const src = cfg && typeof cfg === 'object' ? (cfg.common ?? cfg) : {};
    return {
        deadman: { ...DEFAULT_DEADMAN, ...(src.deadman ?? {}) },
        claudeTimeoutMs:
            typeof src.claudeTimeoutMs === 'number'
                ? src.claudeTimeoutMs
                : DEFAULT_CLAUDE_TIMEOUT_MS,
    };
}

// Порог тишины (мс) для режима. Неизвестный режим → default (fail-safe: не занижаем).
function silenceThresholdMs(activity, cfg) {
    const { deadman, claudeTimeoutMs } = readCfg(cfg);
    switch (activity) {
        case 'coder':
            return claudeTimeoutMs + deadman.iterationGraceMs;
        case 'gate':
            return deadman.gateSilenceMs;
        default:
            return deadman.defaultSilenceMs;
    }
}

// Удобный композит: хвост лога → порог. Монитор сравнит его с (сейчас − время
// последней записи лога) и решит про пуш.
function thresholdForTail(lines, cfg) {
    return silenceThresholdMs(classifyActivity(lines), cfg);
}

module.exports = {
    classifyActivity,
    silenceThresholdMs,
    thresholdForTail,
    DEFAULT_DEADMAN,
    DEFAULT_CLAUDE_TIMEOUT_MS,
    CODER_RE,
    GATE_RE,
    DEFAULT_RE,
};
