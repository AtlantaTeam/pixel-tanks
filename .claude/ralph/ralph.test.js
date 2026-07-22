// Юнит-тесты на функции Linux-порта ralph.js (#66/#67 → #69).
// Покрываем ровно то, что изменил порт: построение argv для claude (guard/путь —
// вместо shell-строки), сам вызов spawn-функции с shell:false (граница anti-RCE
// защиты, не только сборка argv), формат excerpt (вместо shell-санитизации) и
// парсинг API-лимита. Тесты детерминированы: время мокается фейк-таймерами,
// платформо- и TZ-независимы (deltas считаются между двумя локально-
// сконструированными Date).
// Окружение (node, без DOM-setupFiles приложения) задаёт project "ralph" в
// vitest.config.ts — этому файлу отдельный докблок @vitest-environment не нужен.
//
// spawnClaude тестируем через явную инъекцию фейковой spawn-функции (3-й параметр),
// НЕ через vi.mock('node:child_process'): мок модуля на границе CJS require()
// (которым ralph.js подключает child_process) ненадёжен — при первой попытке тест
// пробился до настоящего spawnSync и запустил живой процесс `claude` вместо фейка.
// Явный параметр детерминирован независимо от того, как раннер загружен.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import ralph from './ralph.js';

const {
    resolveProfile,
    deepMerge,
    parseProfileFlag,
    startMonitor,
    stopMonitor,
    adoptMonitor,
    monitorAlive,
    isMonitorProcess,
    ensureMonitorAlive,
    buildClaudeArgs,
    formatExcerpt,
    parseResetWaitMs,
    API_LIMIT_RE,
    spawnClaude,
    tunnelHealthy,
    ensureTunnel,
    tunnelCheckEnabled,
    pushEvent,
    probeEgress,
    restartTunnel,
    resolveWorktreePath,
    parseWorktreeList,
    runnerWorktreeReady,
    ensureRunnerWorktree,
    lockHash,
    syncDepsIfLockChanged,
    preflight,
    runLoop,
    loadState,
    ensureClean,
    parkOnOriginMain,
    gateChecksFor,
    checksGreen,
    tryMergePhase,
    getLastRedCheck,
    getVerifiedHead,
} = ralph;

describe('buildClaudeArgs — построение argv для claude -p (ядро порта)', () => {
    it('минимальный вызов: -p <prompt> --max-turns <n> и больше ничего при пустом конфиге', () => {
        const argv = buildClaudeArgs('привет', { maxTurns: 200 }, {});
        expect(argv).toEqual(['-p', 'привет', '--max-turns', '200']);
    });

    it('maxTurns приводится к строке (spawnSync требует строковые argv)', () => {
        const argv = buildClaudeArgs('x', { maxTurns: 30 }, {});
        expect(argv[3]).toBe('30');
        expect(typeof argv[3]).toBe('string');
    });

    it('model добавляет пару --model <model>', () => {
        const argv = buildClaudeArgs('x', { model: 'claude-opus-4-8', maxTurns: 200 }, {});
        expect(argv).toContain('--model');
        expect(argv[argv.indexOf('--model') + 1]).toBe('claude-opus-4-8');
    });

    it('permissionMode из конфига добавляет --permission-mode', () => {
        const argv = buildClaudeArgs(
            'x',
            { maxTurns: 200 },
            { permissionMode: 'bypassPermissions' },
        );
        expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    });

    it('fallbackModel добавляется, когда задан в конфиге и noFallback не выставлен', () => {
        const argv = buildClaudeArgs('x', { maxTurns: 200 }, { fallbackModel: 'claude-sonnet-5' });
        expect(argv[argv.indexOf('--fallback-model') + 1]).toBe('claude-sonnet-5');
    });

    it('noFallback=true подавляет --fallback-model даже при заданном fallbackModel (M8: ревью без тихой деградации)', () => {
        const argv = buildClaudeArgs(
            'x',
            { maxTurns: 200, noFallback: true },
            { fallbackModel: 'claude-sonnet-5' },
        );
        expect(argv).not.toContain('--fallback-model');
    });

    it('без fallbackModel в конфиге флаг fallback не появляется', () => {
        const argv = buildClaudeArgs('x', { maxTurns: 200 }, {});
        expect(argv).not.toContain('--fallback-model');
    });

    it('полный набор опций: порядок флагов детерминирован', () => {
        const argv = buildClaudeArgs(
            'задача',
            { model: 'claude-fable-5', maxTurns: 100 },
            { permissionMode: 'bypassPermissions', fallbackModel: 'claude-sonnet-5' },
        );
        expect(argv).toEqual([
            '-p',
            'задача',
            '--max-turns',
            '100',
            '--model',
            'claude-fable-5',
            '--permission-mode',
            'bypassPermissions',
            '--fallback-model',
            'claude-sonnet-5',
        ]);
    });

    it('anti-RCE: спецсимволы промпта проходят ОДНИМ дословным элементом argv, не раскрываются и не разбиваются', () => {
        // Ровно тот класс, ради которого порт ушёл от shell-строки: backtick/$()/%/
        // кавычки/точка-с-запятой на /bin/sh были бы command substitution (RCE), на
        // cmd.exe % раскрывался бы в %VAR%. В argv-массиве всё это — байты промпта.
        const evil = 'вывод: `rm -rf /` и $(whoami) и %PATH% и "кавычки" ; echo pwned';
        const argv = buildClaudeArgs(evil, { maxTurns: 200 }, {});
        // Промпт — ровно один элемент, идентичный входу (ничего не срезано/не экранировано).
        expect(argv[1]).toBe(evil);
        // Никакой лишний элемент не появился из-за пробелов/точки-с-запятой внутри промпта.
        expect(argv).toHaveLength(4);
    });

    it('промпт с переводами строк и кавычками остаётся единым элементом', () => {
        const multiline = 'строка1\nstring "2"\n\tтаб';
        const argv = buildClaudeArgs(multiline, { maxTurns: 200 }, {});
        expect(argv[1]).toBe(multiline);
    });

    it('чистота: не мутирует переданный конфиг', () => {
        const cfg = { permissionMode: 'bypassPermissions', fallbackModel: 'claude-sonnet-5' };
        const snapshot = JSON.stringify(cfg);
        buildClaudeArgs('x', { maxTurns: 200 }, cfg);
        expect(JSON.stringify(cfg)).toBe(snapshot);
    });
});

describe('spawnClaude — фактический вызов spawn-функции (граница anti-RCE защиты)', () => {
    // buildClaudeArgs выше проверяет только сборку argv-массива. Здесь — что этот
    // массив реально доходит до вызова ОДНИМ элементом на промпт и с shell:false:
    // именно это, а не сама сборка массива, закрывает RCE-класс (#67). Регрессия вида
    // «shell:false случайно потерялся при рефакторе» ловится только тут.
    // Фейковую spawn-функцию передаём 3-м параметром явно (см. комментарий в шапке
    // файла) — production-путь (без 3-го аргумента) здесь намеренно не трогаем,
    // чтобы не дёргать настоящий claude.exe из юнит-теста.
    let spawnFn;
    beforeEach(() => {
        spawnFn = vi.fn();
        // log() на пути сигнала пишет в console.log и в файл ralph.log — глушим оба
        // побочных эффекта, тестам чистых веток spawnClaude они не нужны.
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('вызывает spawnFn с бинарём claude, shell:false и ровно тем argv-массивом, что построил buildClaudeArgs', () => {
        spawnFn.mockReturnValue({ status: 0, stdout: 'ok', stderr: '', signal: null });
        const evil = 'вывод: `rm -rf /` и $(whoami) и %PATH%';
        const argv = buildClaudeArgs(evil, { maxTurns: 200 }, {});

        spawnClaude(argv, 60_000, spawnFn);

        expect(spawnFn).toHaveBeenCalledTimes(1);
        const [bin, calledArgs, opts] = spawnFn.mock.calls[0];
        expect(bin).toBe('claude');
        // Тот же массив, не пересобран и не сериализован в строку — промпт со
        // спецсимволами доходит до вызова одним элементом argv, а не только до
        // чистой сборки массива в buildClaudeArgs.
        expect(calledArgs).toBe(argv);
        expect(calledArgs[1]).toBe(evil);
        expect(opts.shell).toBe(false);
        expect(opts.timeout).toBe(60_000);
    });

    it('успешное завершение (status:0) → {code:0, output: stdout+stderr}', () => {
        spawnFn.mockReturnValue({ status: 0, stdout: 'done', stderr: '', signal: null });
        expect(spawnClaude(['-p', 'x', '--max-turns', '1'], 1000, spawnFn)).toEqual({
            code: 0,
            output: 'done\n',
        });
    });

    it('ненулевой exit-код процесса пробрасывается как code', () => {
        spawnFn.mockReturnValue({ status: 2, stdout: '', stderr: 'boom', signal: null });
        expect(spawnClaude(['-p', 'x', '--max-turns', '1'], 1000, spawnFn)).toEqual({
            code: 2,
            output: '\nboom',
        });
    });

    it('процесс убит по сигналу (таймаут) → code:1, не бросает исключение', () => {
        spawnFn.mockReturnValue({ status: null, stdout: '', stderr: '', signal: 'SIGTERM' });
        const result = spawnClaude(['-p', 'x', '--max-turns', '1'], 1000, spawnFn);
        expect(result.code).toBe(1);
    });
});

describe('formatExcerpt — хвост вывода упавшего чека для heal-промпта', () => {
    it('сплющивает переводы строк, табы и повторные пробелы в один пробел', () => {
        expect(formatExcerpt('a\n\nb\t\tc   d')).toBe('a b c d');
    });

    it('обрезает до последних 600 символов', () => {
        const long = 'X'.repeat(1000);
        const out = formatExcerpt(long);
        expect(out).toHaveLength(600);
        expect(out).toBe('X'.repeat(600));
    });

    it('короткую строку без лишних пробелов возвращает как есть', () => {
        expect(formatExcerpt('FAIL: boom')).toBe('FAIL: boom');
    });

    it('anti-regression: спецсимволы вывода СОХРАНЯЮТСЯ дословно (санитизация под shell удалена)', () => {
        // Раньше excerpt чистился под shell-guard; теперь промпт уходит argv-массивом,
        // и backtick/$/кавычки должны дойти до heal-агента как есть — без потери контекста ошибки.
        const raw = 'Error in `foo()`: $undefined and "quoted" — code 1';
        const out = formatExcerpt(raw);
        expect(out).toContain('`foo()`');
        expect(out).toContain('$undefined');
        expect(out).toContain('"quoted"');
    });
});

describe('parseResetWaitMs — время до сброса окна API-лимита', () => {
    // Фиксируем «сейчас» = локальное 2026-01-15 10:00:00. Delta между двумя
    // локально-сконструированными Date не зависит от TZ хоста → тест детерминирован.
    const H = 3600_000;
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 15, 10, 0, 0, 0));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('«resets 11am» (позже сейчас в тот же день) → 1 час', () => {
        expect(parseResetWaitMs('you can retry — resets 11am')).toBe(1 * H);
    });

    it('«reset at 7:30pm» → 9.5 часа (12h-формат, pm)', () => {
        expect(parseResetWaitMs('limit will reset at 7:30pm')).toBe(9.5 * H);
    });

    it('«resets 3am» (уже прошло сегодня) → переносится на завтра', () => {
        // с 10:00 до завтрашних 03:00 = 17 часов
        expect(parseResetWaitMs('resets 3am')).toBe(17 * H);
    });

    it('«resets 12am» трактуется как полночь (h=0), не 12:00', () => {
        // ближайшая полночь — завтра 00:00 = через 14 часов
        expect(parseResetWaitMs('resets 12am')).toBe(14 * H);
    });

    it('«resets 12pm» трактуется как полдень (h=12) → 2 часа', () => {
        expect(parseResetWaitMs('resets 12pm')).toBe(2 * H);
    });

    it('невалидный час (>23) → null (вызывающий возьмёт fallback)', () => {
        expect(parseResetWaitMs('resets 27')).toBeNull();
    });

    it('нет упоминания reset → null', () => {
        expect(parseResetWaitMs('just a normal claude output, all good')).toBeNull();
    });
});

describe('API_LIMIT_RE — детекция маркера лимита в выводе сессии', () => {
    it.each([
        "You've hit your session limit · resets 1:20pm",
        'usage limit reached',
        'rate-limit exceeded',
        'rate limit hit',
        '5-hour limit will reset soon',
        'your window resets at 3am',
        'limit exceeded',
    ])('распознаёт маркер лимита: %s', (text) => {
        expect(API_LIMIT_RE.test(text)).toBe(true);
    });

    it.each([
        'All tests passed',
        'Error: cannot find module',
        'build succeeded in 12s',
        'no problems detected',
    ])('НЕ ложно-срабатывает на обычном выводе: %s', (text) => {
        expect(API_LIMIT_RE.test(text)).toBe(false);
    });
});

describe('tunnelHealthy — ядро egress-проверки туннеля (#92)', () => {
    it('egress точно равен ожидаемому → здоров', () => {
        expect(tunnelHealthy('203.0.113.7', '203.0.113.7')).toBe(true);
    });

    it('egress не тот (вышли не через прокси) → не здоров', () => {
        expect(tunnelHealthy('198.51.100.2', '203.0.113.7')).toBe(false);
    });

    it('пустой egress (curl упал/таймаут) → не здоров', () => {
        expect(tunnelHealthy('', '203.0.113.7')).toBe(false);
    });

    it('пустой ожидаемый (egress не с чем сверять) → не здоров', () => {
        expect(tunnelHealthy('203.0.113.7', '')).toBe(false);
    });
});

describe('tunnelCheckEnabled — включение health-check', () => {
    const savedEnv = { ...process.env };
    afterEach(() => {
        process.env = { ...savedEnv };
    });

    it('по умолчанию (нет env-флага, config без tunnelCheck) — выключен', () => {
        delete process.env.RALPH_TUNNEL_CHECK;
        expect(tunnelCheckEnabled({})).toBe(false);
    });

    it('config.tunnelCheck.enabled=true → включён', () => {
        delete process.env.RALPH_TUNNEL_CHECK;
        expect(tunnelCheckEnabled({ tunnelCheck: { enabled: true } })).toBe(true);
    });

    it('env RALPH_TUNNEL_CHECK=1 включает даже при config.enabled=false (мост до профилей)', () => {
        process.env.RALPH_TUNNEL_CHECK = '1';
        expect(tunnelCheckEnabled({ tunnelCheck: { enabled: false } })).toBe(true);
    });
});

describe('ensureTunnel — оркестровка health-check (мок curl: совпал/не совпал IP)', () => {
    // ensureTunnel логирует через log() (console.log + запись в ralph.log) — глушим
    // оба побочных эффекта. Зависимости (probe/restart/sleepFn/push) инжектируем, так
    // что ни реального curl, ни systemctl, ни сна тут нет — тест детерминирован.
    const savedEnv = { ...process.env };
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
        process.env = {
            ...savedEnv,
            RALPH_TUNNEL_CHECK: '1',
            RALPH_EXPECTED_EGRESS: '203.0.113.7',
        };
    });
    afterEach(() => {
        vi.restoreAllMocks();
        process.env = { ...savedEnv };
    });

    it('проверка выключена → пропуск (true), probe даже не вызывается', () => {
        delete process.env.RALPH_TUNNEL_CHECK;
        const probe = vi.fn();
        expect(ensureTunnel({}, { probe })).toBe(true);
        expect(probe).not.toHaveBeenCalled();
    });

    it('включена, но нет ожидаемого egress → fail-open (true) с предупреждением, без probe', () => {
        delete process.env.RALPH_EXPECTED_EGRESS;
        delete process.env.SS_SERVER;
        const probe = vi.fn();
        expect(ensureTunnel({ tunnelCheck: { enabled: true } }, { probe })).toBe(true);
        expect(probe).not.toHaveBeenCalled();
    });

    it('egress сразу совпал → здоров (true), без перезапуска', () => {
        const probe = vi.fn().mockReturnValue('203.0.113.7');
        const restart = vi.fn();
        expect(ensureTunnel({}, { probe, restart })).toBe(true);
        expect(probe).toHaveBeenCalledTimes(1);
        expect(restart).not.toHaveBeenCalled();
    });

    it('ожидаемый egress с хвостовым CRLF/пробелом (ralph.env часто редактируют на Windows) → trim, сравнение всё равно проходит (ревью #98)', () => {
        process.env.RALPH_EXPECTED_EGRESS = '203.0.113.7\r\n';
        const probe = vi.fn().mockReturnValue('203.0.113.7');
        expect(ensureTunnel({}, { probe })).toBe(true);
    });

    it('egress красный → перезапуск → повторно совпал → восстановлен (true)', () => {
        const probe = vi
            .fn()
            .mockReturnValueOnce('198.51.100.2')
            .mockReturnValueOnce('203.0.113.7');
        const restart = vi.fn();
        const sleepFn = vi.fn();
        const push = vi.fn();
        expect(ensureTunnel({}, { probe, restart, sleepFn, push })).toBe(true);
        expect(restart).toHaveBeenCalledTimes(1);
        expect(sleepFn).toHaveBeenCalledTimes(1);
        expect(probe).toHaveBeenCalledTimes(2);
        expect(push).not.toHaveBeenCalled(); // восстановился — человека не будим
    });

    it('egress красный и после перезапуска красный → false + пуш человеку', () => {
        const probe = vi.fn().mockReturnValue('198.51.100.2'); // мимо прокси оба раза
        const restart = vi.fn();
        const sleepFn = vi.fn();
        const push = vi.fn();
        expect(ensureTunnel({}, { probe, restart, sleepFn, push })).toBe(false);
        expect(restart).toHaveBeenCalledTimes(1);
        expect(probe).toHaveBeenCalledTimes(2);
        expect(push).toHaveBeenCalledTimes(1);
        expect(push.mock.calls[0][0]).toMatch(/туннел/i);
    });

    it('пустой egress (curl упал) дважды → false + пуш', () => {
        const probe = vi.fn().mockReturnValue('');
        const push = vi.fn();
        expect(ensureTunnel({}, { probe, restart: vi.fn(), sleepFn: vi.fn(), push })).toBe(false);
        expect(push).toHaveBeenCalledTimes(1);
    });
});

describe('pushEvent — доставка событий в Telegram, prod-only (#86)', () => {
    it('лог-маркер печатается ВСЕГДА, независимо от профиля', () => {
        const logFn = vi.fn();
        const sendFn = vi.fn();
        pushEvent('событие', { profileName: 'playground' }, { sendFn, logFn });
        expect(logFn).toHaveBeenCalledWith(expect.stringContaining('событие'));
    });

    it('playground (или профиль не задан) — sendFn НЕ зовётся, событие не улетает', () => {
        const sendFn = vi.fn();
        const logFn = vi.fn();
        expect(pushEvent('релиз готов', { profileName: 'playground' }, { sendFn, logFn })).toBe(
            false,
        );
        expect(pushEvent('релиз готов', {}, { sendFn, logFn })).toBe(false);
        // cfg=undefined фиксирует именно поведение при СРАБОТКЕ дефолта `cfg = config`:
        // config заполняется в main(), а не при require, поэтому на момент вызова он
        // undefined → профиля нет → событие не улетает. Кейс `{}` выше уже покрывает
        // «профиль задан пустым»; этот — отдельно страхует, что дефолт-ветка молчит,
        // а не подхватывает боевой profileName, если config когда-нибудь станет
        // top-level.
        expect(pushEvent('релиз готов', undefined, { sendFn, logFn })).toBe(false);
        expect(sendFn).not.toHaveBeenCalled();
    });

    it('prod — sendFn зовётся с текстом сообщения, результат прокидывается наружу', () => {
        const sendFn = vi.fn().mockReturnValue(true);
        const logFn = vi.fn();
        const result = pushEvent(
            'фаза готова к релизу',
            { profileName: 'prod' },
            { sendFn, logFn },
        );
        expect(result).toBe(true);
        expect(sendFn).toHaveBeenCalledTimes(1);
        expect(sendFn.mock.calls[0][0]).toBe('фаза готова к релизу');
    });

    it('prod, но доставка не удалась (fail-open sendFn=false) — pushEvent тоже false, не бросает', () => {
        const sendFn = vi.fn().mockReturnValue(false);
        expect(() =>
            pushEvent('событие', { profileName: 'prod' }, { sendFn, logFn: vi.fn() }),
        ).not.toThrow();
        expect(pushEvent('событие', { profileName: 'prod' }, { sendFn, logFn: vi.fn() })).toBe(
            false,
        );
    });

    it('prod, но dry=true (--dry-run) — лог-маркер есть, но sendFn НЕ зовётся, false (C1: read-only)', () => {
        // Регрессия: breaker maxIterations проверяется до первого dry-guard'а в loop,
        // так что pushEvent достижим в --dry-run. Guard в самой точке доставки (как
        // saveState) обязан молчать даже в боевом профиле.
        const sendFn = vi.fn();
        const logFn = vi.fn();
        expect(pushEvent('событие', { profileName: 'prod' }, { sendFn, logFn, dry: true })).toBe(
            false,
        );
        expect(logFn).toHaveBeenCalledWith(expect.stringContaining('событие'));
        expect(sendFn).not.toHaveBeenCalled();
    });

    it('интеграционный шов: дефолтный sendFn (реальный нотифаер) зовёт curl через прокинутый execFn', () => {
        // Без мока sendFn — проверяем, что pushEvent реально дёргает sendTelegramMessage,
        // а тот вызывает curl. execFn пробрасывается насквозь (без сети/токена).
        const execFn = vi.fn().mockReturnValue(JSON.stringify({ ok: true }));
        const logFn = vi.fn();
        const saved = { ...process.env };
        process.env.RALPH_TG_BOT_TOKEN = '123:test';
        process.env.RALPH_TG_CHAT_ID = '42';
        try {
            const result = pushEvent(
                'фаза готова к релизу',
                { profileName: 'prod' },
                { logFn, execFn },
            );
            expect(result).toBe(true);
            expect(execFn).toHaveBeenCalledTimes(1);
            expect(execFn.mock.calls[0][0]).toBe('curl');
        } finally {
            process.env = saved;
        }
    });
});

describe('runClaude — 4-е событие (#88): API-лимит пушит уведомление и повторяет попытку', () => {
    const { runClaude } = ralph;

    it('маркер лимита в выводе → pushEventFn с текстом попытки/ожидания, sleepFn ждёт, повтор runClaudeOnceFn', () => {
        const runClaudeOnceFn = vi
            .fn()
            .mockReturnValueOnce({ code: 1, output: "You've hit your session limit · resets 11am" })
            .mockReturnValueOnce({ code: 0, output: 'ok' });
        const pushEventFn = vi.fn();
        const sleepFn = vi.fn();
        const ensureTunnelFn = vi.fn(() => true);
        const cfg = { apiLimitMaxWaits: 3, apiLimitGraceMin: 0 };

        const code = runClaude(
            'промпт',
            { model: 'sonnet' },
            {
                pushEventFn,
                sleepFn,
                ensureTunnelFn,
                runClaudeOnceFn,
                cfg,
            },
        );

        expect(code).toBe(0);
        expect(runClaudeOnceFn).toHaveBeenCalledTimes(2);
        expect(pushEventFn).toHaveBeenCalledTimes(1);
        // Форматирование сообщения: попытка (N/maxWaits) и время ожидания читаемы без консоли.
        expect(pushEventFn.mock.calls[0][0]).toMatch(/API-лимит/);
        expect(pushEventFn.mock.calls[0][0]).toMatch(/попытка 1\/3/);
        expect(pushEventFn.mock.calls[0][1]).toBe(cfg);
        expect(sleepFn).toHaveBeenCalledTimes(1);
    });

    it('без маркера лимита (обычный сбой) — pushEventFn не зовётся, повтора нет', () => {
        const runClaudeOnceFn = vi.fn().mockReturnValue({ code: 1, output: 'просто упало' });
        const pushEventFn = vi.fn();
        const sleepFn = vi.fn();

        const code = runClaude(
            'промпт',
            {},
            {
                pushEventFn,
                sleepFn,
                ensureTunnelFn: () => true,
                runClaudeOnceFn,
                cfg: { apiLimitMaxWaits: 3 },
            },
        );

        expect(code).toBe(1);
        expect(runClaudeOnceFn).toHaveBeenCalledTimes(1);
        expect(pushEventFn).not.toHaveBeenCalled();
        expect(sleepFn).not.toHaveBeenCalled();
    });

    it('лимит попыток исчерпан (apiLimitMaxWaits) — не уходит в вечный цикл, возвращает последний код', () => {
        const runClaudeOnceFn = vi
            .fn()
            .mockReturnValue({ code: 1, output: 'session limit resets 11am' });
        const pushEventFn = vi.fn();
        const sleepFn = vi.fn();

        const code = runClaude(
            'промпт',
            {},
            {
                pushEventFn,
                sleepFn,
                ensureTunnelFn: () => true,
                runClaudeOnceFn,
                cfg: { apiLimitMaxWaits: 2 },
            },
        );

        expect(code).toBe(1);
        // attempt: 0 и 1 — пуш+сон, на attempt=2 (>= maxWaits) выход без ещё одного пуша.
        expect(runClaudeOnceFn).toHaveBeenCalledTimes(3);
        expect(pushEventFn).toHaveBeenCalledTimes(2);
        expect(sleepFn).toHaveBeenCalledTimes(2);
    });

    it('cfg.waitOnApiLimit === false — маркер лимита есть, но повтор/пуш выключены явно', () => {
        const runClaudeOnceFn = vi
            .fn()
            .mockReturnValue({ code: 1, output: 'session limit resets 11am' });
        const pushEventFn = vi.fn();

        const code = runClaude(
            'промпт',
            {},
            {
                pushEventFn,
                sleepFn: vi.fn(),
                ensureTunnelFn: () => true,
                runClaudeOnceFn,
                cfg: { waitOnApiLimit: false },
            },
        );

        expect(code).toBe(1);
        expect(runClaudeOnceFn).toHaveBeenCalledTimes(1);
        expect(pushEventFn).not.toHaveBeenCalled();
    });
});

describe('probeEgress — фактический вызов curl (граница anti-RCE защиты, ревью #98)', () => {
    // Как и spawnClaude (#67): execFileSync без shell — здесь проверяем ГРАНИЦУ, не
    // только чистую сборку. execFn инжектируем явно (не vi.mock('node:child_process') —
    // см. шапку файла), production-путь (execFileSync по умолчанию) не трогаем.
    const savedEnv = { ...process.env };
    beforeEach(() => {
        // probeEgress читает HTTPS_PROXY/HTTP_PROXY НАПРЯМУЮ из process.env раньше
        // cfg.tunnelCheck.proxyUrl (см. приоритет в самой функции) — если у машины,
        // на которой гоняются тесты, реально настроен прокси (как оказалось на этой
        // машине при первом прогоне — тест ловил боевой HTTPS_PROXY вместо тестового
        // cfg.proxyUrl и падал), тест перестаёт быть детерминированным. Чистим оба
        // перед каждым тестом этого блока, а не только сохраняем/восстанавливаем.
        delete process.env.HTTPS_PROXY;
        delete process.env.HTTP_PROXY;
    });
    afterEach(() => {
        process.env = { ...savedEnv };
    });

    it('вызывает execFn с бинарём curl и proxy/ipUrl отдельными элементами argv, без -x/URL, склеенных шелл-строкой', () => {
        const execFn = vi.fn().mockReturnValue('203.0.113.7\n');
        const evilProxy = 'http://127.0.0.1:8118; echo pwned';
        const cfg = { tunnelCheck: { proxyUrl: evilProxy, ipCheckUrl: 'https://api.ipify.org' } };

        probeEgress(cfg, execFn);

        expect(execFn).toHaveBeenCalledTimes(1);
        const [bin, cmdArgs, opts] = execFn.mock.calls[0];
        expect(bin).toBe('curl');
        // Значение с ; целиком в ОДНОМ элементе argv — не раскрывается как команда,
        // не разбивается по пробелу (в отличие от сборки через строку в execSync-шелле).
        expect(cmdArgs).toContain(evilProxy);
        expect(cmdArgs.filter((a) => a === evilProxy)).toHaveLength(1);
        expect(cmdArgs).toContain('-4');
        expect(opts.encoding).toBe('utf-8');
    });

    it('результат execFn обрезается (trim) от перевода строки, который curl добавляет в вывод', () => {
        const execFn = vi.fn().mockReturnValue('203.0.113.7\n');
        expect(probeEgress({}, execFn)).toBe('203.0.113.7');
    });

    it('execFn бросил (таймаут/мёртвый прокси) → пустая строка, не исключение', () => {
        const execFn = vi.fn().mockImplementation(() => {
            throw new Error('Command failed: curl');
        });
        expect(probeEgress({}, execFn)).toBe('');
    });

    it('proxy по умолчанию берётся из HTTPS_PROXY/HTTP_PROXY, иначе из tc.proxyUrl, иначе localhost:8118', () => {
        delete process.env.HTTPS_PROXY;
        delete process.env.HTTP_PROXY;
        const execFn = vi.fn().mockReturnValue('1.2.3.4');
        probeEgress({}, execFn);
        expect(execFn.mock.calls[0][1]).toContain('http://127.0.0.1:8118');
    });
});

describe('restartTunnel — фактический вызов systemctl (граница anti-RCE защиты, ревью #98)', () => {
    it('разбивает restartCmd на бинарь + argv и вызывает execFn без шелла', () => {
        const execFn = vi.fn().mockReturnValue('');
        const cfg = {
            tunnelCheck: {
                restartCmd: 'systemctl restart shadowsocks-libev-local@frankfurt privoxy',
            },
        };

        restartTunnel(cfg, execFn);

        expect(execFn).toHaveBeenCalledWith('systemctl', [
            'restart',
            'shadowsocks-libev-local@frankfurt',
            'privoxy',
        ]);
    });

    it('без restartCmd в конфиге использует дефолт (systemctl restart ss-local+privoxy)', () => {
        const execFn = vi.fn().mockReturnValue('');
        restartTunnel({}, execFn);
        expect(execFn).toHaveBeenCalledWith('systemctl', [
            'restart',
            'shadowsocks-libev-local@frankfurt',
            'privoxy',
        ]);
    });

    it('execFn бросил (systemctl упал) → не пробрасывает исключение (fail-open, финальная сверка egress решит)', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
        const execFn = vi.fn().mockImplementation(() => {
            throw new Error('systemctl: unit not found');
        });
        expect(() => restartTunnel({}, execFn)).not.toThrow();
        vi.restoreAllMocks();
    });
});

describe('resolveWorktreePath — путь выделенного worktree раннера (#76)', () => {
    const savedEnv = { ...process.env };
    afterEach(() => {
        process.env = { ...savedEnv };
    });

    it('по умолчанию — сосед репозитория "pixel-tanks-ralph", не внутри самого дерева', () => {
        delete process.env.RALPH_WORKTREE_PATH;
        expect(resolveWorktreePath({}, '/root/pixel-tanks')).toBe('/root/pixel-tanks-ralph');
    });

    it('cfg.runnerWorktreePath переопределяет дефолт (относительный резолвится от repoRoot)', () => {
        delete process.env.RALPH_WORKTREE_PATH;
        expect(
            resolveWorktreePath({ runnerWorktreePath: '../custom-ralph' }, '/root/pixel-tanks'),
        ).toBe('/root/custom-ralph');
    });

    it('RALPH_WORKTREE_PATH из env переопределяет дефолт, когда в конфиге поле не задано', () => {
        process.env.RALPH_WORKTREE_PATH = '/tmp/ralph-worktree';
        expect(resolveWorktreePath({}, '/root/pixel-tanks')).toBe('/tmp/ralph-worktree');
    });

    it('ОТНОСИТЕЛЬНЫЙ RALPH_WORKTREE_PATH резолвится от repoRoot, а не от cwd вызова (#SiaUv)', () => {
        process.env.RALPH_WORKTREE_PATH = '../custom';
        expect(resolveWorktreePath({}, '/root/pixel-tanks')).toBe('/root/custom');
    });

    it('cfg.runnerWorktreePath важнее env (явный конфиг не должен молча перебиваться)', () => {
        process.env.RALPH_WORKTREE_PATH = '/tmp/from-env';
        expect(
            resolveWorktreePath({ runnerWorktreePath: '/tmp/from-config' }, '/root/pixel-tanks'),
        ).toBe('/tmp/from-config');
    });
});

describe('ensureRunnerWorktree — выделенный git worktree раннера, соседний с деревом человека (#76)', () => {
    // repoRoot фиксируем явно: guard «путь не внутри репозитория» (#SiaUT) иначе бы
    // сверялся с process.cwd() и зависел бы от того, откуда запущен vitest.
    const REPO = '/root/pixel-tanks';
    const WT = '/root/pixel-tanks-ralph';

    it('уже зарегистрирован и папка на месте → переиспользуем, без add/fetch/npm ci', () => {
        const shFn = vi
            .fn()
            .mockReturnValue(
                'worktree /root/pixel-tanks\nHEAD abc123\nbranch refs/heads/main\n\n' +
                    'worktree /root/pixel-tanks-ralph\nHEAD def456\ndetached\n',
            );
        const existsFn = vi.fn().mockReturnValue(true);
        const logFn = vi.fn();
        const installFn = vi.fn();
        const addFn = vi.fn();
        const refreshFn = vi.fn();
        const result = ensureRunnerWorktree(WT, {
            shFn,
            existsFn,
            logFn,
            installFn,
            addFn,
            refreshFn,
            repoRoot: REPO,
        });
        expect(result).toBe(WT);
        expect(shFn).toHaveBeenCalledTimes(1); // только list, без add/npm ci
        expect(addFn).not.toHaveBeenCalled();
        expect(installFn).not.toHaveBeenCalled();
        // Дерево переиспользуем, но не «как есть»: его переводят на свежий
        // origin/main, иначе кодер-сессия читает ralph.md прошлого прогона.
        expect(refreshFn).toHaveBeenCalledWith(WT, expect.anything());
    });

    it('#SiaUG: зарегистрирован, но папки на диске нет (rm -rf без git worktree remove) → fail с рецептом prune', () => {
        const shFn = vi
            .fn()
            .mockReturnValue(
                'worktree /root/pixel-tanks\nHEAD abc123\nbranch refs/heads/main\n\n' +
                    'worktree /root/pixel-tanks-ralph\nHEAD def456\ndetached\n',
            );
        const existsFn = vi.fn().mockReturnValue(false); // папки нет
        const failFn = vi.fn(() => {
            throw new Error('stopped');
        });
        const installFn = vi.fn();
        expect(() =>
            ensureRunnerWorktree(WT, { shFn, existsFn, failFn, installFn, repoRoot: REPO }),
        ).toThrow('stopped');
        expect(failFn.mock.calls[0][0]).toMatch(/git worktree prune/);
        expect(installFn).not.toHaveBeenCalled();
    });

    it('не зарегистрирован и путь свободен → git fetch origin main + add (argv, execFile) + npm ci', () => {
        const shFn = vi
            .fn()
            .mockReturnValueOnce(
                'worktree /root/pixel-tanks\nHEAD abc123\nbranch refs/heads/main\n',
            )
            .mockReturnValue('');
        const existsFn = vi.fn().mockReturnValue(false);
        const installFn = vi.fn();
        const addFn = vi.fn();
        const markFn = vi.fn();
        const logFn = vi.fn();
        const result = ensureRunnerWorktree(WT, {
            shFn,
            existsFn,
            installFn,
            addFn,
            markFn,
            logFn,
            repoRoot: REPO,
        });
        expect(result).toBe(WT);
        // База — свежий origin/main, а не текущий HEAD дерева человека (#499).
        expect(shFn).toHaveBeenCalledWith('git fetch origin main');
        // add идёт через argv-collaborator (execFile без shell) — путь одним аргументом (#SiaUP).
        expect(addFn).toHaveBeenCalledWith(WT);
        expect(installFn).toHaveBeenCalledWith(WT);
        expect(markFn).toHaveBeenCalledWith(WT); // маркер lock засеян
    });

    it('#SiaUT: путь ВНУТРИ репозитория → fail-closed до любых git-побочек', () => {
        const shFn = vi.fn();
        const failFn = vi.fn(() => {
            throw new Error('stopped');
        });
        expect(() =>
            ensureRunnerWorktree('/root/pixel-tanks/nested-ralph', {
                shFn,
                failFn,
                repoRoot: REPO,
            }),
        ).toThrow('stopped');
        expect(failFn.mock.calls[0][0]).toMatch(/внутри репозитория/);
        expect(shFn).not.toHaveBeenCalled(); // даже git worktree list не звали
    });

    it('путь занят посторонним (не в git worktree list, но существует на диске) → fail-closed, не трогаем', () => {
        const shFn = vi
            .fn()
            .mockReturnValue('worktree /root/pixel-tanks\nHEAD abc123\nbranch refs/heads/main\n');
        const existsFn = vi.fn().mockReturnValue(true);
        const failFn = vi.fn(() => {
            throw new Error('stopped');
        });
        const installFn = vi.fn();
        expect(() =>
            ensureRunnerWorktree(WT, { shFn, existsFn, failFn, installFn, repoRoot: REPO }),
        ).toThrow('stopped');
        expect(failFn).toHaveBeenCalledTimes(1);
        // #SiaUJ: сообщение НЕ советует prune (тут папка есть, но не зарегистрирована).
        expect(failFn.mock.calls[0][0]).toMatch(/посторонней папкой/);
        expect(failFn.mock.calls[0][0]).not.toMatch(/prune/);
        expect(installFn).not.toHaveBeenCalled();
    });

    it('git worktree list упал (не git-репо/gh недоступен) → fail-closed, add не вызывается', () => {
        const shFn = vi.fn().mockImplementation(() => {
            throw new Error('not a git repository');
        });
        const failFn = vi.fn(() => {
            throw new Error('stopped');
        });
        const addFn = vi.fn();
        expect(() => ensureRunnerWorktree(WT, { shFn, failFn, addFn, repoRoot: REPO })).toThrow(
            'stopped',
        );
        expect(failFn.mock.calls[0][0]).toMatch(/git worktree list/);
        expect(addFn).not.toHaveBeenCalled();
    });

    it('git worktree add упал → fail-closed, npm ci не запускается', () => {
        const shFn = vi
            .fn()
            .mockReturnValueOnce(
                'worktree /root/pixel-tanks\nHEAD abc123\nbranch refs/heads/main\n',
            )
            .mockReturnValue('');
        const existsFn = vi.fn().mockReturnValue(false);
        const addFn = vi.fn(() => {
            throw new Error('branch already checked out');
        });
        const failFn = vi.fn(() => {
            throw new Error('stopped');
        });
        const installFn = vi.fn();
        const logFn = vi.fn();
        expect(() =>
            ensureRunnerWorktree(WT, {
                shFn,
                existsFn,
                addFn,
                failFn,
                installFn,
                logFn,
                repoRoot: REPO,
            }),
        ).toThrow('stopped');
        expect(installFn).not.toHaveBeenCalled();
    });

    it('npm ci упал (испорченный package-lock/сеть) → fail-closed', () => {
        const shFn = vi
            .fn()
            .mockReturnValueOnce(
                'worktree /root/pixel-tanks\nHEAD abc123\nbranch refs/heads/main\n',
            )
            .mockReturnValue('');
        const existsFn = vi.fn().mockReturnValue(false);
        const addFn = vi.fn();
        const installFn = vi.fn(() => {
            throw new Error('npm ci failed');
        });
        const failFn = vi.fn(() => {
            throw new Error('stopped');
        });
        const logFn = vi.fn();
        expect(() =>
            ensureRunnerWorktree(WT, {
                shFn,
                existsFn,
                addFn,
                installFn,
                failFn,
                logFn,
                repoRoot: REPO,
            }),
        ).toThrow('stopped');
        expect(failFn.mock.calls[0][0]).toMatch(/npm ci/);
    });
});

describe('runnerWorktreeReady — «дерево раннера уже поднято?» для read-only переезда DRY (#SiaT3)', () => {
    const WT = '/root/pixel-tanks-ralph';
    const listWith = 'worktree /root/pixel-tanks\n\nworktree /root/pixel-tanks-ralph\ndetached\n';

    it('зарегистрирован И папка на месте → true (dry переедет читать state оттуда)', () => {
        const shFn = vi.fn().mockReturnValue(listWith);
        const existsFn = vi.fn().mockReturnValue(true);
        expect(runnerWorktreeReady(WT, { shFn, existsFn })).toBe(true);
    });

    it('зарегистрирован, но папки нет (rm -rf) → false (dry не chdir в несуществующее)', () => {
        const shFn = vi.fn().mockReturnValue(listWith);
        const existsFn = vi.fn().mockReturnValue(false);
        expect(runnerWorktreeReady(WT, { shFn, existsFn })).toBe(false);
    });

    it('не зарегистрирован → false', () => {
        const shFn = vi.fn().mockReturnValue('worktree /root/pixel-tanks\n');
        const existsFn = vi.fn().mockReturnValue(true);
        expect(runnerWorktreeReady(WT, { shFn, existsFn })).toBe(false);
    });

    it('git worktree list упал → false (dry остаётся в текущем дереве, не падает)', () => {
        const shFn = vi.fn(() => {
            throw new Error('not a git repo');
        });
        expect(runnerWorktreeReady(WT, { shFn, existsFn: () => true })).toBe(false);
    });
});

describe('syncDepsIfLockChanged — авто-npm ci при смене package-lock перед чеками (#SiaUX)', () => {
    const HASH_OF = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex');

    it('lockHash: sha256 содержимого package-lock.json, null если файла нет', () => {
        expect(lockHash('/x', () => 'LOCKDATA')).toBe(HASH_OF('LOCKDATA'));
        expect(
            lockHash('/x', () => {
                throw new Error('ENOENT');
            }),
        ).toBeNull();
    });

    it('lock не менялся (маркер == хэш) → npm ci НЕ гоняется', () => {
        const lock = 'LOCK-A';
        const installFn = vi.fn();
        syncDepsIfLockChanged({
            logFn: () => {},
            existsFn: () => true,
            readFn: (p) => (String(p).endsWith('package-lock.json') ? lock : HASH_OF(lock)),
            installFn,
        });
        expect(installFn).not.toHaveBeenCalled();
    });

    it('lock изменился (маркер != хэш) → npm ci гоняется и маркер перезаписывается', () => {
        const installFn = vi.fn();
        const writes = [];
        syncDepsIfLockChanged({
            logFn: () => {},
            existsFn: () => true,
            readFn: (p) =>
                String(p).endsWith('package-lock.json') ? 'LOCK-NEW' : HASH_OF('LOCK-OLD'),
            writeFn: (p, data) => writes.push([p, data]),
            installFn,
        });
        expect(installFn).toHaveBeenCalledTimes(1);
        // Маркер перезаписан новым хэшем — следующий гейт с тем же lock не переустановит.
        expect(writes.some(([, data]) => data === HASH_OF('LOCK-NEW'))).toBe(true);
    });

    it('нет package-lock.json → no-op (сверять нечего, npm ci не гоняется)', () => {
        const installFn = vi.fn();
        syncDepsIfLockChanged({
            logFn: () => {},
            existsFn: () => true,
            readFn: () => {
                throw new Error('ENOENT');
            },
            installFn,
        });
        expect(installFn).not.toHaveBeenCalled();
    });

    it('маркера ещё нет (первый гейт после bootstrap) → prev=null, npm ci гоняется', () => {
        const installFn = vi.fn();
        syncDepsIfLockChanged({
            logFn: () => {},
            existsFn: () => false, // маркер-файла нет
            readFn: (p) => (String(p).endsWith('package-lock.json') ? 'LOCK' : ''),
            writeFn: () => {},
            installFn,
        });
        expect(installFn).toHaveBeenCalledTimes(1);
    });
});

describe('preflight — валидация конфига/среды и подготовка контекста (#99)', () => {
    // preflight принимает cfg и зависимости с побочками (sh/fail/log/загрузка state/
    // свип milestones/проверка мерджа) параметрами — как ensureTunnel. Инжектируем их,
    // поэтому тут нет ни git/gh, ни process.exit, ни диска. failFn БРОСАЕТ (а не
    // process.exit) — так assert ловит нужную ветку и останавливает выполнение ровно
    // там же, где в проде остановил бы exit(1). Флаги режима once/dry/resubmit тоже
    // инжектируются в preflight (дефолты из module-level ONCE/DRY/RESUBMIT), поэтому их
    // ветки (грязное дерево, свип milestones, бюджет итераций) тестируются явно, а не
    // зависят от того, с какими аргументами запущен vitest.
    const throwingFail = (msg) => {
        throw new Error(msg);
    };
    const fakeState = () => ({ count: 0, milestone: 'M1', submitted: false, noProgress: 0 });
    // Дефолты «зелёного» пути: shFn — чистое дерево, свип/мердж — noop, фаза текущая
    // (индекс 0, инвариант C4 не гоняется). loadStateFn ЗДЕСЬ намеренно НЕ задаём: где
    // нужен фейк state — передаём loadStateFn: fakeState явно через overrides; где хотим
    // проверить реальный loadState — не передаём, тогда сработает дефолт параметра
    // (module-level loadState). Так не приходится удалять ключ из собранного объекта.
    const okDeps = (overrides = {}) => ({
        shFn: () => '',
        failFn: throwingFail,
        logFn: () => {},
        closeMilestonesFn: () => {},
        phaseIndexOfFn: () => 0,
        phaseMergedFn: () => true,
        saveStateFn: () => {},
        ...overrides,
    });
    const validCfg = (overrides = {}) => ({
        active: true,
        phases: [{ milestone: 'M1', branch: 'feature/m1' }],
        authorAllowlist: ['owner'],
        ...overrides,
    });

    it('active: false → fail с сообщением про active', () => {
        expect(() => preflight({ active: false }, okDeps())).toThrow(/active/i);
    });

    it('пустой authorAllowlist → fail (C3): публичный репо + bypassPermissions', () => {
        const cfg = validCfg({ authorAllowlist: [] });
        expect(() => preflight(cfg, okDeps())).toThrow(/authorAllowlist/);
    });

    it('отсутствующий authorAllowlist → тоже fail (C3)', () => {
        const cfg = { active: true, phases: [{ milestone: 'M1', branch: 'b' }] };
        expect(() => preflight(cfg, okDeps())).toThrow(/authorAllowlist/);
    });

    it('нет phases → fail', () => {
        const cfg = { active: true, phases: [], authorAllowlist: ['owner'] };
        expect(() => preflight(cfg, okDeps())).toThrow(/phases/i);
    });

    describe('профиль prod требует RALPH_TG_* (#85, fail-closed как authorAllowlist)', () => {
        const savedEnv = { ...process.env };
        beforeEach(() => {
            process.env = { ...savedEnv };
            delete process.env.RALPH_TG_BOT_TOKEN;
            delete process.env.RALPH_TG_CHAT_ID;
        });
        afterEach(() => {
            process.env = savedEnv;
        });

        it('prod без RALPH_TG_BOT_TOKEN/RALPH_TG_CHAT_ID → fail', () => {
            const cfg = validCfg({ profileName: 'prod' });
            expect(() => preflight(cfg, okDeps({ loadStateFn: fakeState }))).toThrow(
                /RALPH_TG_BOT_TOKEN/,
            );
        });

        it('prod с заполненными RALPH_TG_* правильной формы → проверка проходит (не бросает на этой ветке)', () => {
            process.env.RALPH_TG_BOT_TOKEN = '123456789:AAExampleTokenLooksLikeThisThirtyPlusChars';
            process.env.RALPH_TG_CHAT_ID = '-1001234567890';
            const cfg = validCfg({ profileName: 'prod' });
            expect(() => preflight(cfg, okDeps({ loadStateFn: fakeState }))).not.toThrow();
        });

        it('prod с плейсхолдер-токеном неверной формы → fail (не только наличие, но и форма)', () => {
            // Правдоподобный плейсхолдер, скопированный из ralph.env.example без правки,
            // дал бы 401 на каждый пуш, а fail-open молча съел бы события. Отсекаем на старте.
            process.env.RALPH_TG_BOT_TOKEN = '123456789:XXXX';
            process.env.RALPH_TG_CHAT_ID = '42';
            const cfg = validCfg({ profileName: 'prod' });
            expect(() => preflight(cfg, okDeps({ loadStateFn: fakeState }))).toThrow(
                /не похож на токен/,
            );
        });

        it('prod с chat_id не-числом → fail', () => {
            process.env.RALPH_TG_BOT_TOKEN = '123456789:AAExampleTokenLooksLikeThisThirtyPlusChars';
            process.env.RALPH_TG_CHAT_ID = 'not-a-number';
            const cfg = validCfg({ profileName: 'prod' });
            expect(() => preflight(cfg, okDeps({ loadStateFn: fakeState }))).toThrow(
                /не похож на chat_id/,
            );
        });

        it('playground (без profileName) — проверка TG не применяется даже с пустым env', () => {
            const cfg = validCfg(); // profileName не задан → playground
            expect(() => preflight(cfg, okDeps({ loadStateFn: fakeState }))).not.toThrow();
        });
    });

    it('state старой схемы (phaseIndex, без milestone) → fail (через реальный loadState)', () => {
        // Не инжектируем loadStateFn — работает РЕАЛЬНЫЙ loadState (дефолт), которому
        // preflight пробрасывает свой failFn. Диск мокаем на старую схему: единственное
        // fs-чтение на этом пути preflight — как раз внутри loadState (остальные побочки
        // инжектированы). Так тест покрывает настоящую валидацию схемы, а не заглушку.
        vi.spyOn(fs, 'readFileSync').mockReturnValue(
            JSON.stringify({ count: 3, phaseIndex: 0, submitted: false }),
        );
        // Не передаём loadStateFn → сработает дефолт параметра = реальный loadState.
        try {
            expect(() => preflight(validCfg(), okDeps())).toThrow(/схем|phaseIndex/i);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('валидный конфиг + дефолтный state → возвращает { state, maxIterations, maxTurns }', () => {
        const state = { count: 2, milestone: 'M1', submitted: false, noProgress: 0 };
        const cfg = validCfg({ maxIterations: 7, maxTurns: 150 });
        const closeMilestonesFn = vi.fn();
        const phaseMergedFn = vi.fn();
        const ctx = preflight(
            cfg,
            okDeps({ loadStateFn: () => state, closeMilestonesFn, phaseMergedFn }),
        );
        expect(ctx).toEqual({ state, maxIterations: 7, maxTurns: 150 });
        // Свип milestones выполнен (не DRY), инвариант C4 не гонялся (текущая фаза, idx 0).
        expect(closeMilestonesFn).toHaveBeenCalledTimes(1);
        expect(phaseMergedFn).not.toHaveBeenCalled();
    });

    it('maxIterations/maxTurns берут дефолты (10/200), когда не заданы в конфиге', () => {
        const ctx = preflight(validCfg(), okDeps({ loadStateFn: fakeState }));
        expect(ctx.maxIterations).toBe(10);
        expect(ctx.maxTurns).toBe(200);
    });

    // ── Негативные ветки среды и инвариант зависимых фаз C4 (ревью PR #102) ──────
    // Правила проекта требуют негативные сценарии. Раньше phaseIndexOfFn был всюду
    // () => 0, поэтому тело C4 (for i < startIdx) ни разу не выполнялось, а ветки sh
    // (не git-репо / gh не авторизован / грязное дерево) были непокрыты.

    // shFn, который бросает только на команде, содержащей needle (иначе — чистый вывод).
    const shThrowingOn = (needle) => (cmd) => {
        if (cmd.includes(needle)) throw new Error(`fail: ${cmd}`);
        return '';
    };

    it('C4: предыдущая фаза не смерджена (phaseMerged=false) → fail «Инвариант нарушен»', () => {
        const cfg = validCfg({
            phases: [
                { milestone: 'M1', branch: 'feature/m1' },
                { milestone: 'M2', branch: 'feature/m2' },
            ],
        });
        // startIdx=1 → цикл проверяет фазу M1; phaseMergedFn=false → инвариант нарушен.
        const deps = okDeps({
            loadStateFn: () => ({ count: 0, milestone: 'M2', submitted: false, noProgress: 0 }),
            phaseIndexOfFn: () => 1,
            phaseMergedFn: () => false,
        });
        expect(() => preflight(cfg, deps)).toThrow(/Инвариант нарушен/);
    });

    it('C4: phaseMerged бросил исключение → fail «Не смог проверить мердж-статус»', () => {
        const cfg = validCfg({
            phases: [
                { milestone: 'M1', branch: 'feature/m1' },
                { milestone: 'M2', branch: 'feature/m2' },
            ],
        });
        const deps = okDeps({
            loadStateFn: () => ({ count: 0, milestone: 'M2', submitted: false, noProgress: 0 }),
            phaseIndexOfFn: () => 1,
            phaseMergedFn: () => {
                throw new Error('gh недоступен');
            },
        });
        expect(() => preflight(cfg, deps)).toThrow(/Не смог проверить мердж-статус/);
    });

    it('git rev-parse падает → fail «Не git-репозиторий»', () => {
        const deps = okDeps({ loadStateFn: fakeState, shFn: shThrowingOn('rev-parse') });
        expect(() => preflight(validCfg(), deps)).toThrow(/Не git-репозиторий/);
    });

    it('gh auth status падает → fail «gh CLI не авторизован»', () => {
        const deps = okDeps({ loadStateFn: fakeState, shFn: shThrowingOn('gh auth status') });
        expect(() => preflight(validCfg(), deps)).toThrow(/gh CLI не авторизован/);
    });

    it('грязное дерево при dry=false → fail «Рабочее дерево грязное»', () => {
        const deps = okDeps({
            loadStateFn: fakeState,
            shFn: (cmd) => (cmd.includes('status --porcelain') ? ' M src/x.ts' : ''),
            dry: false,
        });
        expect(() => preflight(validCfg(), deps)).toThrow(/Рабочее дерево грязное/);
    });

    it('грязное дерево при dry=true → НЕ падает (dry-run read-only, правки не требуются)', () => {
        const deps = okDeps({
            loadStateFn: fakeState,
            shFn: (cmd) => (cmd.includes('status --porcelain') ? ' M src/x.ts' : ''),
            dry: true,
            // При dry=true свип milestones тоже пропускается — closeMilestonesFn не зовётся.
            closeMilestonesFn: () => {
                throw new Error('свип не должен вызываться при dry');
            },
        });
        expect(() => preflight(validCfg(), deps)).not.toThrow();
    });

    it('once=true → maxIterations=1 (бюджет одной HITL-итерации), иначе дефолт конфига', () => {
        const cfg = validCfg({ maxIterations: 9 });
        const withOnce = preflight(cfg, okDeps({ loadStateFn: fakeState, once: true }));
        expect(withOnce.maxIterations).toBe(1);
        const withoutOnce = preflight(cfg, okDeps({ loadStateFn: fakeState, once: false }));
        expect(withoutOnce.maxIterations).toBe(9);
    });

    it('resubmit=true → сбрасывает state.submitted и сохраняет через saveStateFn', () => {
        const state = { count: 2, milestone: 'M1', submitted: true, noProgress: 0 };
        const saveStateFn = vi.fn();
        preflight(validCfg(), okDeps({ loadStateFn: () => state, saveStateFn, resubmit: true }));
        expect(state.submitted).toBe(false);
        expect(saveStateFn).toHaveBeenCalledWith(state);
    });
});

describe('loadState — резолв state с диска (прямой тест, #99)', () => {
    // Прямой тест экспортируемого loadState (а не только через preflight): валидный
    // state возвращается как есть; state старой схемы (без milestone) зовёт инжектируемый
    // failFn. Ветку «нет файла → defaultState()» тут не гоняем — defaultState читает
    // глобальный config.phases[0], который в юнит-среде не инициализирован.
    afterEach(() => vi.restoreAllMocks());

    it('валидный state (с milestone) возвращается как есть', () => {
        const state = { count: 5, milestone: 'M3', submitted: true, noProgress: 1 };
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(state));
        expect(loadState()).toEqual(state);
    });

    it('state старой схемы (без milestone) → зовёт инжектированный failFn', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(
            JSON.stringify({ count: 3, phaseIndex: 0, submitted: false }),
        );
        const failFn = vi.fn();
        loadState(failFn);
        expect(failFn).toHaveBeenCalledTimes(1);
        expect(failFn.mock.calls[0][0]).toMatch(/схем|phaseIndex/i);
    });
});

describe('runLoop — основной while-цикл: итерации кодера, сдача, гейт, self-heal (#104)', () => {
    // runLoop получил DI (как preflight/ensureTunnel): коллабораторы с побочками
    // (log/sh/saveState/openIssues/runClaude/tryMergePhase/…) и флаги once/dry —
    // параметрами. Инжектируем фейки, поэтому здесь нет ни git/gh, ни спавна claude,
    // ни диска. Терминация цикла: phaseIndexOfFn по умолчанию — счётчик, отдающий
    // валидный индекс на 1-м проходе и «за концом» на 2-м, поэтому любой сценарий с
    // continue гарантированно упирается в ветку «все фазы завершены» и не зациклится.
    const mkState = (o = {}) => ({
        count: 0,
        milestone: 'M1',
        submitted: false,
        noProgress: 0,
        gateHeals: 0,
        blockedHeals: 0,
        ...o,
    });
    const validCfg = (o = {}) => ({
        model: 'claude-coder',
        prompt: 'сделай {milestone} в ветке {branch}',
        authorAllowlist: ['owner'],
        phases: [{ milestone: 'M1', branch: 'feature/m1' }],
        ...o,
    });
    // Дефолтные зависимости «пустого зелёного» прохода. logFn собирает строки в
    // переданный массив (assert по тексту веток). Любой сценарий переопределяет нужное.
    const deps = (logs, o = {}) => {
        let idxCalls = 0;
        return {
            once: false,
            dry: false,
            logFn: (m) => logs.push(m),
            shFn: () => '',
            saveStateFn: () => {},
            openIssuesFn: () => [],
            allOpenIssuesFn: () => [],
            // 1-й проход → фаза 0; 2-й и далее → «за концом» массива phases → break.
            phaseIndexOfFn: () => (idxCalls++ === 0 ? 0 : 99),
            pickModelFn: () => 'claude-picked',
            pickReviewModelFn: () => 'none',
            // #138: без этих двух дефолтов тесты, доходившие до шага ревью, звали
            // НАСТОЯЩИЕ phaseDiffFiles/reviewDiffContext — то есть реальный
            // `git fetch origin main feature/m1` (ветка из фикстуры выше) и реальный
            // log(), дописывавший в ralph.log живого прогона.
            phaseDiffFilesFn: () => [],
            reviewDiffContextFn: () => '',
            runClaudeFn: () => 0,
            ensureCleanFn: () => true,
            phaseMergedFn: () => false,
            advancePhaseFn: () => {},
            tryMergePhaseFn: () => 'not-merged',
            closeMilestoneByTitleFn: () => {},
            // #199: тот же безопасный дефолт, что у pushEventFn ниже — настоящий
            // syncProjectBoard зовёт sh('node scripts/project-sync.mjs'), и каждый
            // тест, доходящий до gate === 'merged', ловил бы предохранитель #138.
            syncProjectBoardFn: () => {},
            getLastRedCheck: () => null,
            // #86: безопасный дефолт-заглушка — без него тест, не переопределивший
            // pushEventFn явно, звал бы НАСТОЯЩИЙ pushEvent (реальный log() + попытка
            // sendTelegramMessage в prod-сценариях). Сценарии, проверяющие сам пуш,
            // подменяют его явно.
            pushEventFn: () => false,
            // #151: тот же безопасный дефолт-заглушка, что у pushEventFn/syncProjectBoardFn
            // выше — без него тест, не переопределивший ensureMonitorAliveFn явно, звал бы
            // НАСТОЯЩИЙ ensureMonitorAlive (реальные fs.readFileSync/spawn монитора).
            ensureMonitorAliveFn: () => null,
            ...o,
        };
    };
    const ctx = (state, o = {}) => ({ state, maxIterations: 10, maxTurns: 200, ...o });

    it('фаза не резолвится (все пройдены) → лог «все фазы завершены» и выход', () => {
        const logs = [];
        runLoop(validCfg(), ctx(mkState()), deps(logs, { phaseIndexOfFn: () => 99 }));
        expect(logs.join('\n')).toMatch(/Все фазы завершены/);
    });

    // #151: живость монитора проверяется на КАЖДОМ рабочем проходе while-цикла, не
    // только на старте. Проверка стоит ПОСЛЕ брейкеров: терминальный проход (фаза уже
    // смерджена → advancePhase → 2-й проход «за концом» → `if(!phase) break`) до неё не
    // доходит — переподнимать монитор за мгновение до выхода раннера незачем (exit-
    // хендлер тут же прислал бы ему SIGTERM). Сценарий с continue даёт один рабочий
    // проход и один терминальный → ровно 1 проверка монитора.
    it('#151: ensureMonitorAlive зовётся на рабочем проходе цикла (AFK, не только на старте)', () => {
        const logs = [];
        const ensureMonitorAliveFn = vi.fn(() => null);
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps(logs, {
                phaseMergedFn: () => true,
                ensureMonitorAliveFn,
            }),
        );
        expect(ensureMonitorAliveFn).toHaveBeenCalledTimes(1);
    });

    it('#151: ensureMonitorAlive получает профиль, путь конфига раннера и logFn', () => {
        const logs = [];
        const ensureMonitorAliveFn = vi.fn(() => null);
        // Рабочий проход (idx 0), затем ensureClean=false → break сразу за проверкой
        // монитора: до неё цикл доходит, дальше — нет.
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(mkState()),
            deps(logs, {
                ensureCleanFn: () => false,
                monitorConfigPath: '/tmp/ralph.config.json',
                ensureMonitorAliveFn,
            }),
        );
        // logFn прокидывается сквозь runLoop (DI-паритет с pushEventFn) — проверяем, что
        // до ensureMonitorAlive доезжает именно инжектированный логгер, а не боевой log.
        expect(ensureMonitorAliveFn).toHaveBeenCalledWith(
            expect.objectContaining({
                profile: 'prod',
                configPath: '/tmp/ralph.config.json',
                logFn: expect.any(Function),
            }),
        );
    });

    it('#151: dry=true → ensureMonitorAlive НЕ зовётся (read-only, монитор в dry не поднимается)', () => {
        const logs = [];
        const ensureMonitorAliveFn = vi.fn(() => null);
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps(logs, { dry: true, phaseIndexOfFn: () => 99, ensureMonitorAliveFn }),
        );
        expect(ensureMonitorAliveFn).not.toHaveBeenCalled();
    });

    it('breaker maxIterations (AFK): count>=лимит → сброс count, saveState, стоп, пуш', () => {
        const logs = [];
        const state = mkState({ count: 10 });
        const saveStateFn = vi.fn();
        const runClaudeFn = vi.fn(() => 0);
        const pushEventFn = vi.fn();
        runLoop(
            validCfg(),
            ctx(state, { maxIterations: 10 }),
            deps(logs, { phaseIndexOfFn: () => 0, saveStateFn, runClaudeFn, pushEventFn }),
        );
        expect(state.count).toBe(0);
        expect(saveStateFn).toHaveBeenCalled();
        expect(runClaudeFn).not.toHaveBeenCalled(); // до итерации не дошли
        // #86: событие «circuit breaker открылся» уходит пушем — и pushEvent теперь
        // единственный логгер события (маркер 🔔 PUSH), парного logFn больше нет.
        expect(pushEventFn).toHaveBeenCalledTimes(1);
        expect(pushEventFn.mock.calls[0][0]).toMatch(/Ralph: circuit breaker — лимит итераций/);
        expect(pushEventFn.mock.calls[0][2]).toMatchObject({ logFn: expect.any(Function) });
    });

    it('грязное дерево между итерациями (ensureClean=false, dry=false) → стоп до issues', () => {
        const logs = [];
        const openIssuesFn = vi.fn(() => []);
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps(logs, { phaseIndexOfFn: () => 0, ensureCleanFn: () => false, openIssuesFn }),
        );
        // Прервались на ensureClean — очередь issues даже не запрашивалась.
        expect(openIssuesFn).not.toHaveBeenCalled();
    });

    it('кодер-итерация в ONCE: одна claude-сессия нужной моделью и стоп', () => {
        const logs = [];
        const state = mkState();
        const runClaudeFn = vi.fn(() => 0);
        runLoop(
            validCfg(),
            ctx(state),
            deps(logs, {
                once: true,
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [{ number: 5, title: 'задача', labels: [] }],
                pickModelFn: () => 'claude-picked',
                runClaudeFn,
            }),
        );
        expect(runClaudeFn).toHaveBeenCalledTimes(1);
        const [prompt, opts] = runClaudeFn.mock.calls[0];
        // Плейсхолдеры промпта подставлены (replaceAll — оба {..}).
        expect(prompt).toContain('M1');
        expect(prompt).toContain('feature/m1');
        expect(opts).toEqual({ model: 'claude-picked', maxTurns: 200 });
        expect(state.count).toBe(1);
        expect(logs.join('\n')).toMatch(/HITL: одна итерация/);
    });

    it('no-progress breaker (AFK): HEAD не сдвинулся и очередь та же → стоп, пуш', () => {
        const logs = [];
        const state = mkState({ noProgress: 2 }); // +1 на этой итерации = 3 = порог
        const pushEventFn = vi.fn();
        runLoop(
            validCfg(),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [{ number: 7, title: 't', labels: [] }],
                shFn: () => 'SAME_HEAD', // headBefore === headAfter → нет коммитов
                runClaudeFn: () => 0,
                pushEventFn,
            }),
        );
        expect(state.noProgress).toBe(0); // сброшен перед стопом
        // #86: событие «circuit breaker открылся» уходит пушем (единственный логгер).
        expect(pushEventFn).toHaveBeenCalledTimes(1);
        expect(pushEventFn.mock.calls[0][0]).toMatch(/Ralph: circuit breaker.*без прогресса/s);
    });

    it('пустая очередь, но открыты blocked/чужие issues → сдача отложена, гейт не зовётся', () => {
        const logs = [];
        const tryMergePhaseFn = vi.fn(() => 'merged');
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [{ number: 9, author: { login: 'stranger' } }],
                tryMergePhaseFn,
            }),
        );
        expect(logs.join('\n')).toMatch(/вне очереди|отложена/);
        expect(tryMergePhaseFn).not.toHaveBeenCalled();
    });

    it('фаза уже смерджена (идемпотентность, AFK): fetch + detach origin/main, advancePhase, дальше', () => {
        const logs = [];
        const shCmds = [];
        const advancePhaseFn = vi.fn();
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps(logs, {
                // counter-дефолт: 1-й проход фаза 0, 2-й → «за концом» → выход
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => true,
                shFn: (c) => {
                    shCmds.push(c);
                    return '';
                },
                advancePhaseFn,
            }),
        );
        // #77: worktree-модель — раннер обновляется через origin/main (fetch + detach),
        // локальный main не трогает вовсе: его ref держит дерево человека.
        expect(shCmds).toContain('git fetch origin main');
        expect(shCmds).toContain('git checkout --detach origin/main');
        expect(shCmds).not.toContain('git checkout main');
        expect(shCmds).not.toContain('git pull --ff-only');
        expect(advancePhaseFn).toHaveBeenCalledTimes(1);
        expect(logs.join('\n')).toMatch(/уже смерджена/);
    });

    it('фаза смерджена при dry=true → advancePhase есть, но БЕЗ мутаций git (checkout/pull не зовутся)', () => {
        const logs = [];
        const shCmds = [];
        const advancePhaseFn = vi.fn();
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps(logs, {
                dry: true,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => true,
                shFn: (c) => {
                    shCmds.push(c);
                    return '';
                },
                advancePhaseFn,
            }),
        );
        expect(shCmds).not.toContain('git fetch origin main');
        expect(shCmds).not.toContain('git checkout --detach origin/main');
        expect(advancePhaseFn).toHaveBeenCalled();
    });

    it('submitted=true → сразу к гейту, без PR/ревью/правок', () => {
        const logs = [];
        const runClaudeFn = vi.fn(() => 0);
        const tryMergePhaseFn = vi.fn(() => 'not-merged');
        runLoop(
            validCfg(),
            ctx(mkState({ submitted: true })),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                runClaudeFn,
                tryMergePhaseFn,
            }),
        );
        expect(runClaudeFn).not.toHaveBeenCalled(); // сдача пропущена
        expect(tryMergePhaseFn).toHaveBeenCalledTimes(1);
        expect(logs.join('\n')).toMatch(/уже прошла PR\/ревью\/правки/);
    });

    it('зовёт синк в начале итерации — issues закрываются асинхронно после мерджа', () => {
        const syncProjectBoardFn = vi.fn();
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps([], {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => true, // фаза уже смерджена → выход после первой итерации
                syncProjectBoardFn,
            }),
        );
        expect(syncProjectBoardFn).toHaveBeenCalled();
    });

    it('в dry-run доску не трогает', () => {
        const syncProjectBoardFn = vi.fn();
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps([], {
                dry: true,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => true,
                syncProjectBoardFn,
            }),
        );
        expect(syncProjectBoardFn).not.toHaveBeenCalled();
    });

    it('полная сдача → гейт merged → закрыть milestone + advancePhase + пуш «готова к релизу»', () => {
        const logs = [];
        const closeMilestoneByTitleFn = vi.fn();
        const advancePhaseFn = vi.fn();
        const tryMergePhaseFn = vi.fn(() => 'merged');
        const pushEventFn = vi.fn();
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none', // ревью пропущено → сдача = PR + правки
                runClaudeFn: () => 0,
                tryMergePhaseFn,
                closeMilestoneByTitleFn,
                advancePhaseFn,
                pushEventFn,
            }),
        );
        expect(tryMergePhaseFn).toHaveBeenCalledTimes(1);
        expect(closeMilestoneByTitleFn).toHaveBeenCalledWith('M1');
        expect(advancePhaseFn).toHaveBeenCalledTimes(1);
        expect(logs.join('\n')).toMatch(/Ревью PR — за супервизором/);
        // #86: событие «релиз-готовность» уходит пушем при успешном мердже фазы.
        expect(pushEventFn).toHaveBeenCalledTimes(1);
        expect(pushEventFn.mock.calls[0][0]).toMatch(/готова к релизу/);
    });

    it('#87 prod: гейт merged → деплой-плейсхолдер вызван, loop останавливается (не берёт следующую фазу)', () => {
        const logs = [];
        const closeMilestoneByTitleFn = vi.fn();
        const advancePhaseFn = vi.fn();
        const tryMergePhaseFn = vi.fn(() => 'merged');
        const pushEventFn = vi.fn();
        const deployPhaseFn = vi.fn();
        const phaseIndexOfFn = vi.fn(() => 0); // не 99 на втором вызове — если дойдёт, тест это увидит
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn,
                closeMilestoneByTitleFn,
                advancePhaseFn,
                pushEventFn,
                deployPhaseFn,
            }),
        );
        expect(closeMilestoneByTitleFn).toHaveBeenCalledWith('M1');
        expect(advancePhaseFn).toHaveBeenCalledTimes(1);
        expect(deployPhaseFn).toHaveBeenCalledTimes(1);
        expect(deployPhaseFn.mock.calls[0][0]).toMatchObject({ milestone: 'M1' });
        // #87: prod останавливается ПЕРЕД деплоем — второй проход while (следующая фаза)
        // не должен состояться, phaseIndexOfFn зовётся ровно 1 раз.
        expect(phaseIndexOfFn).toHaveBeenCalledTimes(1);
        expect(logs.join('\n')).toMatch(/остановлен перед деплоем/);
    });

    it('#87 playground: гейт merged → деплой-плейсхолдер НЕ зовётся, мердж остаётся финалом (continue как раньше)', () => {
        const logs = [];
        const tryMergePhaseFn = vi.fn(() => 'merged');
        const deployPhaseFn = vi.fn();
        runLoop(
            validCfg(), // profileName не задан → playground
            ctx(mkState()),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn,
                deployPhaseFn,
            }),
        );
        expect(deployPhaseFn).not.toHaveBeenCalled();
        // deps() даёт phaseIndexOfFn-счётчик: 2-й вызов «за концом» → «все фазы завершены».
        expect(logs.join('\n')).toMatch(/Все фазы завершены/);
    });

    it('шаг создания PR упал (код≠0) → fail-closed стоп, гейт не зовётся', () => {
        const logs = [];
        const tryMergePhaseFn = vi.fn(() => 'merged');
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                runClaudeFn: () => 1, // PR-сессия упала
                tryMergePhaseFn,
            }),
        );
        expect(logs.join('\n')).toMatch(/Шаг создания PR упал/);
        expect(tryMergePhaseFn).not.toHaveBeenCalled();
    });

    it('гейт blocked, бюджет есть → чини-сессия блокеров, инкремент blockedHeals, submitted=false', () => {
        const logs = [];
        const state = mkState({ submitted: true, blockedHeals: 0 });
        const runClaudeFn = vi.fn(() => 0);
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'blocked',
                runClaudeFn,
            }),
        );
        expect(state.blockedHeals).toBe(1);
        expect(state.submitted).toBe(false); // сброс → повторное ревью на следующем проходе
        expect(runClaudeFn).toHaveBeenCalledTimes(1);
        expect(runClaudeFn.mock.calls[0][0]).toMatch(/blocked/);
    });

    it('гейт blocked, бюджет исчерпан → стоп без чини-сессии, сброс счётчика, пуш человеку', () => {
        const logs = [];
        const state = mkState({ submitted: true, blockedHeals: 3 });
        const runClaudeFn = vi.fn(() => 0);
        const pushEventFn = vi.fn();
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'blocked',
                runClaudeFn,
                pushEventFn,
            }),
        );
        expect(runClaudeFn).not.toHaveBeenCalled();
        expect(state.blockedHeals).toBe(0);
        // #86: событие «blocked отдан человеку» уходит пушем (единственный логгер).
        expect(pushEventFn).toHaveBeenCalledTimes(1);
        expect(pushEventFn.mock.calls[0][0]).toMatch(/blocked устоял/);
    });

    // #216: prod (с включённым разбором) блокер запускает чини-сессию, а не немедленный
    // стоп человеку. Тестируем именно поведение при profileName='prod' + ненулевом лимите.
    it('#216: prod с включённым разбором → блокер запускает чини-сессию, человека не зовём', () => {
        const logs = [];
        const state = mkState({ submitted: true, blockedHeals: 0 });
        const runClaudeFn = vi.fn(() => 0);
        const pushEventFn = vi.fn();
        runLoop(
            validCfg({ blockedHealAttempts: 3, profileName: 'prod' }),
            ctx(state),
            // phaseIndexOfFn НЕ переопределяем: дефолтный счётчик (0 → 99) даёт ровно
            // один рабочий проход, иначе continue после разбора крутил бы цикл до брейкера.
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'blocked',
                runClaudeFn,
                pushEventFn,
            }),
        );
        expect(runClaudeFn).toHaveBeenCalledTimes(1); // разбор пошёл
        expect(state.blockedHeals).toBe(1);
        expect(pushEventFn).not.toHaveBeenCalled(); // блокер не ушёл человеку
    });

    // #216: счётчик не в памяти процесса — новое значение уходит в state ДО чини-сессии,
    // поэтому перезапуск раннера посреди разбора его не обнулит (loadState прочитает 2).
    it('#216: инкремент blockedHeals персистится через saveState (переживает перезапуск)', () => {
        const logs = [];
        const state = mkState({ submitted: true, blockedHeals: 1 });
        const saved = [];
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'blocked',
                runClaudeFn: () => 0,
                saveStateFn: (s) => saved.push({ ...s }),
            }),
        );
        expect(saved.some((s) => s.blockedHeals === 2)).toBe(true);
    });

    // #216: чистое повторное ревью завершает разбор — счётчик оставивших блок ревью в
    // ноль. Гейт дошёл до чеков (red-checks) = на PR нет label blocked = ревью блок не
    // поставило. Без сброса чередование «блок → чисто → блок» набирало бы «три подряд»
    // и зря дёргало человека. Считаем ПОДРЯД идущие блок-ревью, а не круги вообще.
    it('#216: чистое повторное ревью (red-checks) обнуляет blockedHeals — чередование не копит счётчик', () => {
        const logs = [];
        const state = mkState({ submitted: true, blockedHeals: 2 });
        runLoop(
            validCfg({ blockedHealAttempts: 3, gateHealAttempts: 2 }),
            ctx(state),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'red-checks',
                getLastRedCheck: () => ({ name: 'test', cmd: 'npm run test', excerpt: 'boom' }),
                runClaudeFn: () => 0,
            }),
        );
        expect(state.blockedHeals).toBe(0);
    });

    // #216: prod больше не ставит blockedHealAttempts: 0, но ветка «явно выключено»
    // осталась для конфигов, где разбор выключат сознательно. Обещание ветки: не «в
    // конфиге 0», а «чини-сессия не запускается вовсе». Регресс `?? 3` → `|| 3` ловится
    // только так. profileName взят произвольный — важно само значение 0, не имя профиля.
    it('blockedHealAttempts=0 (разбор выключен явно) → блокер сразу человеку, чини-сессия НЕ зовётся, пуш уходит', () => {
        const logs = [];
        const state = mkState({ submitted: true, blockedHeals: 0 });
        const runClaudeFn = vi.fn(() => 0);
        const pushEventFn = vi.fn();
        runLoop(
            validCfg({ blockedHealAttempts: 0, profileName: 'prod' }),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'blocked',
                runClaudeFn,
                pushEventFn,
            }),
        );
        expect(runClaudeFn).not.toHaveBeenCalled();
        // #86: даже при 0 попытках разбора событие «blocked отдан человеку» уходит
        // пушем (единственный логгер). Сообщение говорит «выключено профилем», а не
        // «устоял после 0 разборов».
        expect(pushEventFn).toHaveBeenCalledTimes(1);
        expect(pushEventFn.mock.calls[0][0]).toMatch(/выключен профилем "prod"/);
        expect(pushEventFn.mock.calls[0][0]).not.toMatch(/устоял после 0/);
    });

    it('гейт red-checks → чини-сессия гейта с деталями чека из getLastRedCheck', () => {
        const logs = [];
        const state = mkState({ submitted: true, gateHeals: 0 });
        const runClaudeFn = vi.fn(() => 0);
        runLoop(
            validCfg({ gateHealAttempts: 2 }),
            ctx(state),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'red-checks',
                getLastRedCheck: () => ({
                    name: 'test',
                    cmd: 'npm run test',
                    excerpt: 'boom-fail',
                }),
                runClaudeFn,
            }),
        );
        expect(state.gateHeals).toBe(1);
        expect(state.submitted).toBe(false);
        expect(runClaudeFn).toHaveBeenCalledTimes(1);
        const healPrompt = runClaudeFn.mock.calls[0][0];
        expect(healPrompt).toContain('test');
        expect(healPrompt).toContain('npm run test');
        expect(healPrompt).toContain('boom-fail');
    });

    it('гейт not-merged (нечинимая причина) → PR оставлен человеку, стоп', () => {
        const logs = [];
        runLoop(
            validCfg(),
            ctx(mkState({ submitted: true })),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'not-merged',
            }),
        );
        expect(logs.join('\n')).toMatch(/не прошла авто-мердж/);
    });
});

describe('ensureClean — чистота дерева раннера, изолированная от дерева человека (#78)', () => {
    it('чистое дерево (git status пуст) → true', () => {
        const logs = [];
        expect(ensureClean('итерация', { shFn: () => '', logFn: (m) => logs.push(m) })).toBe(true);
        expect(logs).toEqual([]);
    });

    it('грязное дерево (git status непуст) → false, лог с контекстом и выводом status', () => {
        const logs = [];
        const ok = ensureClean('гейт мерджа', {
            shFn: () => ' M src/a.ts\n?? tmp.log',
            logFn: (m) => logs.push(m),
        });
        expect(ok).toBe(false);
        expect(logs.join('\n')).toMatch(/Грязное рабочее дерево \(гейт мерджа\)/);
        expect(logs.join('\n')).toMatch(/src\/a\.ts/);
    });

    it('git status упал (не git-репо/сломан) → false (fail-closed), лог об ошибке', () => {
        const logs = [];
        const ok = ensureClean('итерация', {
            shFn: () => {
                throw new Error('fatal: not a git repository');
            },
            logFn: (m) => logs.push(m),
        });
        expect(ok).toBe(false);
        expect(logs.join('\n')).toMatch(/git status упал/);
    });

    it('спрашивает ровно `git status --porcelain` — per-worktree запрос, не общий на репо', () => {
        // Изоляция — свойство именно этой команды: git status смотрит рабочее дерево
        // ТЕКУЩЕГО worktree. Живой git тут не поднимаем осознанно: под git-хуком
        // (pre-push) в env торчит GIT_DIR, и `git` в подпроцессе теста бьёт по НАСТОЯЩЕМУ
        // репозиторию, а не по tmp — проверено больно. Конвенция файла — DI-моки; сам
        // per-worktree характер команды закреплён этой ассертой.
        const cmds = [];
        ensureClean('итерация', {
            shFn: (c) => {
                cmds.push(c);
                return '';
            },
            logFn: () => {},
        });
        expect(cmds).toEqual(['git status --porcelain']);
    });

    // Критерий #78 на уровне ralph: правки человека в соседнем дереве в вердикт не
    // попадают. Реальный sh после process.chdir (#76) выполняет `git status` в cwd
    // раннера, поэтому shFn моделирует ИМЕННО дерево раннера — что бы ни творилось у
    // человека, ensureClean видит только выхлоп своего дерева.
    it('дерево раннера чистое → true, чем бы ни было грязно дерево человека (изоляция)', () => {
        // shFn = «git status в worktree раннера»: раннер ничего не трогал → пусто.
        // (Дерево человека может быть сколь угодно грязным — до этого shFn не доходит.)
        const runnerTreeStatus = () => '';
        expect(ensureClean('итерация', { shFn: runnerTreeStatus, logFn: () => {} })).toBe(true);
    });
});

describe('ветковая хореография в worktree раннера (#77)', () => {
    // Модель после #76: раннер живёт в выделенном worktree, а git не даёт занять один
    // ref двум worktree сразу. Поэтому гейт НЕ занимает именованных веток вовсе:
    // чеки — на detached PR-head sha, парковка/обновление — detached origin/main.
    // Локальный main (ref человека) раннер не трогает никогда.
    const SHA_A = 'a'.repeat(40);
    const SHA_B = 'b'.repeat(40);

    describe('parkOnOriginMain — парковка дерева раннера', () => {
        it('паркует detached на origin/main, НЕ занимая ветку main', () => {
            const shCmds = [];
            parkOnOriginMain({ shFn: (c) => shCmds.push(c), logFn: () => {} });
            expect(shCmds).toEqual(['git checkout --detach origin/main']);
        });

        it('best-effort: сбой checkout не бросает, только лог', () => {
            const logs = [];
            expect(() =>
                parkOnOriginMain({
                    shFn: () => {
                        throw new Error('нет origin/main');
                    },
                    logFn: (m) => logs.push(m),
                }),
            ).not.toThrow();
            expect(logs.join('\n')).toMatch(/origin\/main/);
        });
    });

    describe('checksGreen — чеки гейта на detached PR-голове', () => {
        // Фабрика шаблонного зелёного окружения. Запись команд — всегда в обёртке
        // (shCmds наполняется при любом сценарии); сценарий переопределяет только
        // ПОВЕДЕНИЕ команд через shImpl (вернуть/бросить) — одну грань за раз.
        const mkDeps = ({ shImpl, ...rest } = {}) => {
            const shCmds = [];
            const parkFn = vi.fn();
            const deps = {
                shFn: (cmd) => {
                    shCmds.push(cmd);
                    if (shImpl) return shImpl(cmd);
                    if (cmd.startsWith('git rev-parse --verify')) return SHA_A;
                    return '';
                },
                ghJsonFn: () => ({ headRefOid: SHA_A }),
                logFn: () => {},
                parkFn,
                // Авто-npm ci при смене lock (#SiaUX) в юнитах глушим — реальный npm ci
                // здесь не нужен; отдельный describe покрывает саму syncDepsIfLockChanged.
                syncDepsFn: () => {},
                ...rest,
            };
            return { shCmds, parkFn, deps };
        };

        it('зелёный путь: fetch → сверка → detach на sha PR → все чеки → true', () => {
            const { shCmds, parkFn, deps } = mkDeps();
            expect(checksGreen('feature/m1', 42, deps)).toBe(true);
            expect(shCmds).toContain("git fetch origin 'feature/m1'");
            expect(shCmds).toContain(`git checkout --detach ${SHA_A}`);
            expect(shCmds).toEqual(
                expect.arrayContaining([
                    'npm run build',
                    'npm run lint',
                    'npm run lint:fsd',
                    'npm run typecheck',
                    'npm run test --silent',
                ]),
            );
            // Именованные ветки не занимаем: ветку фазы держат кодер-сессии,
            // main — дерево человека.
            expect(shCmds).not.toContain('git checkout feature/m1');
            expect(shCmds).not.toContain('git checkout main');
            // На зелёном дерево остаётся на PR-голове (её и мерджим) — парковки нет.
            expect(parkFn).not.toHaveBeenCalled();
        });

        it('#SiaTz/#SiaUX: на зелёном фиксирует голову PR и синкает зависимости после detach', () => {
            const syncDepsFn = vi.fn();
            const { shCmds, deps } = mkDeps({ syncDepsFn });
            expect(checksGreen('feature/m1', 42, deps)).toBe(true);
            // syncDeps зовётся один раз (после detach, до чеков).
            expect(syncDepsFn).toHaveBeenCalledTimes(1);
            expect(shCmds.indexOf(`git checkout --detach ${SHA_A}`)).toBeGreaterThanOrEqual(0);
            // Проверенная голова доступна для --match-head-commit при мердже.
            expect(getVerifiedHead()).toBe(SHA_A);
        });

        it('#SiaTz: голова НЕ фиксируется, если гейт упал до зелёного финала (fetch)', () => {
            const { deps } = mkDeps({
                shImpl: (cmd) => {
                    if (cmd.startsWith('git fetch')) throw new Error('сеть');
                    return '';
                },
            });
            expect(checksGreen('feature/m1', 42, deps)).toBe(false);
            expect(getVerifiedHead()).toBeNull();
        });

        it('H3 в worktree: локальная ветка (общий ref кодер-сессий) != голова PR → false, чеки не гонялись', () => {
            const { shCmds, parkFn, deps } = mkDeps({
                shImpl: (cmd) => {
                    if (cmd.startsWith('git rev-parse --verify')) return SHA_B;
                    return '';
                },
            });
            expect(checksGreen('feature/m1', 42, deps)).toBe(false);
            expect(shCmds).not.toContain('npm run build');
            expect(shCmds).not.toContain(`git checkout --detach ${SHA_A}`);
            expect(parkFn).toHaveBeenCalled();
        });

        it('локальной ветки нет (rev-parse падает) — не фатально: чеки идут на PR-голове', () => {
            const { shCmds, deps } = mkDeps({
                shImpl: (cmd) => {
                    if (cmd.startsWith('git rev-parse --verify'))
                        throw new Error('unknown revision');
                    return '';
                },
            });
            expect(checksGreen('feature/m1', 42, deps)).toBe(true);
            expect(shCmds).toContain(`git checkout --detach ${SHA_A}`);
        });

        it('git fetch упал → false fail-closed, до gh и чеков не дошли', () => {
            const ghJsonFn = vi.fn();
            const { shCmds, parkFn, deps } = mkDeps({
                shImpl: (cmd) => {
                    if (cmd.startsWith('git fetch')) throw new Error('сеть умерла');
                    return '';
                },
                ghJsonFn,
            });
            expect(checksGreen('feature/m1', 42, deps)).toBe(false);
            expect(ghJsonFn).not.toHaveBeenCalled();
            expect(shCmds).not.toContain('npm run build');
            expect(parkFn).toHaveBeenCalled();
        });

        it('headRefOid не 40-hex sha → false ДО интерполяции в git-команду (fail-closed)', () => {
            const { shCmds, parkFn, deps } = mkDeps({
                ghJsonFn: () => ({ headRefOid: 'main; rm -rf /' }),
            });
            expect(checksGreen('feature/m1', 42, deps)).toBe(false);
            expect(shCmds.some((c) => c.includes('rm -rf'))).toBe(false);
            expect(shCmds).not.toContain('npm run build');
            expect(parkFn).toHaveBeenCalled();
        });

        it('красный чек → false, lastRedCheck заполнен именем чека, дерево припарковано', () => {
            const { parkFn, deps } = mkDeps({
                shImpl: (cmd) => {
                    if (cmd.startsWith('git rev-parse --verify')) return SHA_A;
                    if (cmd === 'npm run lint')
                        throw Object.assign(new Error('lint упал'), {
                            stdout: 'no-explicit-any: error',
                            stderr: '',
                        });
                    return '';
                },
            });
            expect(checksGreen('feature/m1', 42, deps)).toBe(false);
            expect(getLastRedCheck()).toMatchObject({ name: 'lint', cmd: 'npm run lint' });
            expect(getLastRedCheck().excerpt).toContain('no-explicit-any');
            expect(parkFn).toHaveBeenCalled();
        });

        it('lastRedCheck сбрасывается В НАЧАЛЕ прогона: сбой fetch не маскируется под red-checks прошлого раунда', () => {
            // Раунд 1: красный чек — lastRedCheck заполнен.
            const red = mkDeps({
                shImpl: (cmd) => {
                    if (cmd.startsWith('git rev-parse --verify')) return SHA_A;
                    if (cmd === 'npm run build') throw new Error('build упал');
                    return '';
                },
            });
            checksGreen('feature/m1', 42, red.deps);
            expect(getLastRedCheck()).toMatchObject({ name: 'build' });
            // Раунд 2: гейт падает ДО чеков (fetch) — старый red-check не должен выжить,
            // иначе tryMergePhase запустил бы чини-сессию по устаревшей ошибке.
            const fetchFail = mkDeps({
                shImpl: (cmd) => {
                    if (cmd.startsWith('git fetch')) throw new Error('сеть');
                    return '';
                },
            });
            expect(checksGreen('feature/m1', 42, fetchFail.deps)).toBe(false);
            expect(getLastRedCheck()).toBeNull();
        });

        it('#80: гоняет ИМЕННО переданный список чеков (прод-набор), а не только базу', () => {
            const { shCmds, deps } = mkDeps({ checks: gateChecksFor('prod') });
            expect(checksGreen('feature/m1', 42, deps)).toBe(true);
            // Прод-набор = база + толстые чеки; в шелл ушли все.
            expect(shCmds).toEqual(
                expect.arrayContaining([
                    'npm run build',
                    'CI=1 npm run test:e2e',
                    'npm run test:coverage',
                    'npm run security:audit',
                ]),
            );
        });

        // #84: каждый толстый чек по отдельности — не только e2e (было покрыто одним
        // тестом при #80) — должен блокировать мердж так же, как базовый. it.each вместо
        // трёх копипаст-тестов: разница между сценариями — ровно (name, cmd), падение
        // остальных чеков в shImpl проверять не нужно — они и так возвращают ''.
        // Толстые = прод-чеки, которых нет в playground (prod дедупит базовый `test`
        // в пользу coverage, поэтому берём разницу по имени, а не slice по длине).
        const playgroundNames = new Set(gateChecksFor('playground').map(([n]) => n));
        const thickChecks = gateChecksFor('prod').filter(([n]) => !playgroundNames.has(n));

        it.each(thickChecks)(
            '#84: красный прод-чек %s блокирует так же, как базовый (fail-closed на каждом толстом чеке)',
            (name, cmd) => {
                const { deps } = mkDeps({
                    checks: gateChecksFor('prod'),
                    shImpl: (c) => {
                        if (c.startsWith('git rev-parse --verify')) return SHA_A;
                        if (c === cmd) throw new Error(`${name} упал`);
                        return '';
                    },
                });
                expect(checksGreen('feature/m1', 42, deps)).toBe(false);
                expect(getLastRedCheck()).toMatchObject({ name, cmd });
            },
        );
    });

    describe('gateChecksFor — состав гейта по профилю (#80)', () => {
        const names = (checks) => checks.map(([name]) => name);

        it('playground = ровно базовые 5 чеков, без толстых', () => {
            expect(names(gateChecksFor('playground'))).toEqual([
                'build',
                'lint',
                'lint:fsd',
                'typecheck',
                'test',
            ]);
        });

        it('prod = база (без дубля test) + fail-fast security/coverage/e2e', () => {
            expect(names(gateChecksFor('prod'))).toEqual([
                'build',
                'lint',
                'lint:fsd',
                'typecheck',
                'security',
                'coverage',
                'e2e',
            ]);
        });

        it('prod дедупит базовый test в пользу coverage (строгое надмножество)', () => {
            const prod = names(gateChecksFor('prod'));
            // Базовый `test` в prod не гоняется — его заменяет coverage (тот же прогон +
            // инструментация): двойной vitest run был бы лишними минутами в гейте.
            expect(prod).not.toContain('test');
            expect(prod).toContain('coverage');
        });

        it('прод-набор покрывает всю базу кроме test и добавляет толстые чеки', () => {
            const base = names(gateChecksFor('playground'));
            const prod = names(gateChecksFor('prod'));
            for (const name of base) {
                if (name === 'test') continue;
                expect(prod).toContain(name);
            }
            expect(prod.length).toBeGreaterThan(base.length);
        });

        it('неизвестный/пустой профиль → только база (безопасный дефолт)', () => {
            expect(names(gateChecksFor('marsian'))).toEqual(names(gateChecksFor('playground')));
            expect(names(gateChecksFor(undefined))).toEqual(names(gateChecksFor('playground')));
        });

        it('каждый чек — пара [имя, команда] с непустой командой', () => {
            for (const [name, cmd] of gateChecksFor('prod')) {
                expect(typeof name).toBe('string');
                expect(name.length).toBeGreaterThan(0);
                expect(typeof cmd).toBe('string');
                expect(cmd.length).toBeGreaterThan(0);
            }
        });

        it('#81: e2e-чек гоняется в детерминированном headless-режиме (CI=1)', () => {
            const [name, cmd] = gateChecksFor('prod').find(([n]) => n === 'e2e');
            expect(name).toBe('e2e');
            // CI=1 переводит Playwright в гейт-режим: forbidOnly + свежий webServer +
            // retries. Без него `.only` протащил бы подмножество как зелёный гейт.
            expect(cmd).toBe('CI=1 npm run test:e2e');
        });
    });

    describe('tryMergePhase — гейт мерджа в worktree-модели', () => {
        const phase = { milestone: 'M1', branch: 'feature/m1' };
        // Зелёное окружение по умолчанию: открытый PR без blocked, зелёные чеки,
        // мердж и пост-мердж git проходят. Сценарии переопределяют одну грань;
        // поведение sh-команд — через shImpl, запись в shCmds всегда в обёртке.
        const mkDeps = ({ shImpl, ...rest } = {}) => {
            const shCmds = [];
            const parkFn = vi.fn();
            const deps = {
                dry: false,
                shFn: (cmd) => {
                    shCmds.push(cmd);
                    return shImpl ? shImpl(cmd) : '';
                },
                logFn: () => {},
                ensureCleanFn: () => true,
                findOpenPrFn: () => ({ number: 5, labels: [] }),
                checksGreenFn: () => true,
                phaseMergedFn: () => false,
                sleepFn: () => {},
                parkFn,
                getLastRedCheckFn: () => null,
                // checksGreenFn здесь замокан и не выставляет lastVerifiedHead; фиксируем
                // геттер, чтобы --match-head-commit не подмешался из module-level остатка
                // прошлого теста (детерминизм). Привязку sha проверяет отдельный тест ниже.
                getVerifiedHeadFn: () => null,
                ...rest,
            };
            return { shCmds, parkFn, deps };
        };

        it('зелёный гейт: squash-merge, затем fetch + detach origin/main → merged', () => {
            const { shCmds, deps } = mkDeps();
            expect(tryMergePhase(phase, deps)).toBe('merged');
            const mergeIdx = shCmds.findIndex(
                (c) => c === "gh pr merge '5' --squash --delete-branch",
            );
            expect(mergeIdx).toBeGreaterThanOrEqual(0);
            // Обновление раннера — строго через origin/main и ПОСЛЕ мерджа.
            expect(shCmds.indexOf('git fetch origin main')).toBeGreaterThan(mergeIdx);
            expect(shCmds).toContain('git checkout --detach origin/main');
            expect(shCmds).not.toContain('git checkout main');
            expect(shCmds).not.toContain('git pull --ff-only');
        });

        it('#80: прокидывает в checksGreen набор чеков по профилю (prod → толстый)', () => {
            const checksGreenFn = vi.fn(() => true);
            const { deps } = mkDeps({ checksGreenFn });
            expect(tryMergePhase(phase, { ...deps, profileName: 'prod' })).toBe('merged');
            const optsArg = checksGreenFn.mock.calls[0][2];
            expect(optsArg.checks.map(([name]) => name)).toEqual(
                gateChecksFor('prod').map(([name]) => name),
            );
        });

        it('#80: без profileName (вне цикла) → базовый набор', () => {
            const checksGreenFn = vi.fn(() => true);
            const { deps } = mkDeps({ checksGreenFn });
            expect(tryMergePhase(phase, deps)).toBe('merged');
            expect(checksGreenFn.mock.calls[0][2].checks.map(([n]) => n)).toEqual(
                gateChecksFor('playground').map(([n]) => n),
            );
        });

        it('#SiaTz: проверенную голову привязывает через --match-head-commit (TOCTOU-защита)', () => {
            const sha = 'd'.repeat(40);
            const { shCmds, deps } = mkDeps({ getVerifiedHeadFn: () => sha });
            expect(tryMergePhase(phase, deps)).toBe('merged');
            expect(shCmds).toContain(
                `gh pr merge '5' --squash --delete-branch --match-head-commit ${sha}`,
            );
        });

        it('#SiaTz: sha головы не 40-hex → мерджим без --match-head-commit (не подставляем мусор)', () => {
            const { shCmds, deps } = mkDeps({ getVerifiedHeadFn: () => 'not-a-sha' });
            expect(tryMergePhase(phase, deps)).toBe('merged');
            expect(shCmds).toContain("gh pr merge '5' --squash --delete-branch");
            expect(shCmds.some((c) => c.includes('--match-head-commit'))).toBe(false);
        });

        it('пост-мердж fetch/detach упал → merged-local-stale (PR влит, дерево раннера отстало)', () => {
            const { deps } = mkDeps({
                shImpl: (cmd) => {
                    if (cmd === 'git fetch origin main') throw new Error('сеть');
                    return '';
                },
            });
            expect(tryMergePhase(phase, deps)).toBe('merged-local-stale');
        });

        it('PR с label blocked → blocked, чеки не гонялись', () => {
            const checksGreenFn = vi.fn();
            const { deps } = mkDeps({
                findOpenPrFn: () => ({ number: 5, labels: [{ name: 'blocked' }] }),
                checksGreenFn,
            });
            expect(tryMergePhase(phase, deps)).toBe('blocked');
            expect(checksGreenFn).not.toHaveBeenCalled();
        });

        it('красный гейт: checksGreen=false + red-check → red-checks; без red-check → not-merged', () => {
            const red = mkDeps({
                checksGreenFn: () => false,
                getLastRedCheckFn: () => ({ name: 'test', cmd: 'npm run test --silent' }),
            });
            expect(tryMergePhase(phase, red.deps)).toBe('red-checks');
            const preChecks = mkDeps({ checksGreenFn: () => false, getLastRedCheckFn: () => null });
            expect(tryMergePhase(phase, preChecks.deps)).toBe('not-merged');
        });

        it('мердж упал дважды и PR не влит → not-merged, парковка на origin/main', () => {
            const sleepFn = vi.fn();
            const { shCmds, parkFn, deps } = mkDeps({
                shImpl: (cmd) => {
                    if (cmd.startsWith('gh pr merge')) throw new Error('merge отвергнут');
                    return '';
                },
                sleepFn,
            });
            expect(tryMergePhase(phase, deps)).toBe('not-merged');
            expect(shCmds.filter((c) => c.startsWith('gh pr merge'))).toHaveLength(2);
            expect(sleepFn).toHaveBeenCalledTimes(1); // пауза только между попытками
            expect(parkFn).toHaveBeenCalled();
            expect(shCmds).not.toContain('git fetch origin main'); // до пост-мерджа не дошли
        });

        it('мердж «упал», но phaseMerged подтверждает влитие → продолжаем как merged', () => {
            const { deps } = mkDeps({
                shImpl: (cmd) => {
                    if (cmd.startsWith('gh pr merge')) throw new Error('оборванный ответ');
                    return '';
                },
                phaseMergedFn: () => true,
            });
            expect(tryMergePhase(phase, deps)).toBe('merged');
        });

        it('dry=true → not-merged, ни одной git/gh-команды (C1 read-only)', () => {
            const shFn = vi.fn();
            const ensureCleanFn = vi.fn();
            const { deps } = mkDeps({ dry: true, shFn, ensureCleanFn });
            expect(tryMergePhase(phase, deps)).toBe('not-merged');
            expect(shFn).not.toHaveBeenCalled();
            expect(ensureCleanFn).not.toHaveBeenCalled();
        });

        it('грязное дерево раннера (ensureClean=false) → not-merged до поиска PR', () => {
            const findOpenPrFn = vi.fn();
            const { deps } = mkDeps({ ensureCleanFn: () => false, findOpenPrFn });
            expect(tryMergePhase(phase, deps)).toBe('not-merged');
            expect(findOpenPrFn).not.toHaveBeenCalled();
        });
    });
});

describe('deepMerge — наследование общих полей профилем (#71)', () => {
    it('вложенные объекты сливаются вглубь: профиль правит одну метку, блок сохраняется', () => {
        const merged = deepMerge(
            { modelRouting: { default: 'opus', labels: { low: 'haiku', high: 'opus' } } },
            { modelRouting: { labels: { high: 'fable' } } },
        );
        expect(merged.modelRouting).toEqual({
            default: 'opus',
            labels: { low: 'haiku', high: 'fable' },
        });
    });

    it('массивы заменяются целиком, а не дописываются', () => {
        expect(deepMerge({ phases: ['A', 'B'] }, { phases: ['C'] }).phases).toEqual(['C']);
    });

    it('скаляр профиля перебивает объект общего блока (и наоборот) без слияния', () => {
        expect(deepMerge({ x: { a: 1 } }, { x: 0 }).x).toBe(0);
        expect(deepMerge({ x: 0 }, { x: { a: 1 } }).x).toEqual({ a: 1 });
    });

    it('не мутирует исходные объекты — общий блок переиспользуется между профилями', () => {
        const common = { a: { x: 1 } };
        deepMerge(common, { a: { x: 2 } });
        expect(common.a.x).toBe(1);
    });

    it('null в профиле затирает значение (осознанное «выключить», не пропуск)', () => {
        expect(
            deepMerge({ tunnelCheck: { enabled: true } }, { tunnelCheck: null }).tunnelCheck,
        ).toBe(null);
    });

    // Опасные ключи — стоп, а не тихая нейтрализация: легитимных полей с такими
    // именами нет, значит это опечатка или чужая рука в конфиге раннера.
    const boom = (m) => {
        throw new Error(m);
    };

    it('ключ __proto__ в профиле → стоп (иначе подменил бы прототип результата)', () => {
        // JSON.parse — как реальный конфиг: "__proto__" становится собственным ключом
        const evil = JSON.parse('{"__proto__": {"active": false}, "maxTurns": 5}');
        expect(() => deepMerge({ maxTurns: 200 }, evil, boom)).toThrow(/запрещённый ключ/);
    });

    it('опасный ключ на вложенном уровне тоже роняет мердж, с путём в сообщении', () => {
        const nested = JSON.parse('{"modelRouting": {"__proto__": {"evil": 1}}}');
        expect(() => deepMerge({ modelRouting: { labels: {} } }, nested, boom)).toThrow(
            /common\.modelRouting/,
        );
    });

    it('опасный ключ в общем блоке ловится так же, как в профиле', () => {
        const base = JSON.parse('{"constructor": {"x": 1}}');
        expect(() => deepMerge(base, {}, boom)).toThrow(/constructor/);
    });

    it('мягкий failFn (монитор) обрывает мердж, а не собирает полуфабрикат', () => {
        const evil = JSON.parse('{"a": {"__proto__": {"x": 1}}, "b": 2}');
        expect(deepMerge({ a: { y: 1 } }, evil, () => null)).toBe(null);
    });
});

describe('findForbiddenKey — скан всей глубины конфига (ревью PR #127)', () => {
    const boom = (m) => {
        throw new Error(m);
    };

    // Объект по ключу, которого нет в common, копируется присваиванием без рекурсии
    // мерджа — раньше его нутро не проверялось вовсе.
    it('опасный ключ в блоке, которого нет в common → стоп с полным путём', () => {
        const evil = JSON.parse('{"newBlock": {"deep": {"__proto__": {"x": 1}}}}');
        expect(() => deepMerge({ a: 1 }, evil, boom)).toThrow(/common\.newBlock\.deep/);
    });

    it('опасный ключ в глубине общего блока тоже ловится', () => {
        const base = JSON.parse('{"a": {"b": {"constructor": 1}}}');
        expect(() => deepMerge(base, {}, boom)).toThrow(/constructor/);
    });

    it('массивы не считаются объектами для скана — легитимный конфиг проходит', () => {
        expect(() => deepMerge({ phases: [{ milestone: 'M' }] }, {}, boom)).not.toThrow();
    });
});

describe('resolveProfile — сборка итогового конфига из common + профиль (#71)', () => {
    const raw = () => ({
        defaultProfile: 'playground',
        common: {
            maxIterations: 10,
            blockedHealAttempts: 3,
            modelRouting: { labels: { high: 'opus' } },
            phases: [{ milestone: 'M', branch: 'b' }],
        },
        profiles: { playground: {}, prod: { blockedHealAttempts: 0 } },
    });
    // failFn инжектируется — отказы проверяем как исключение, без process.exit.
    const boom = (m) => {
        throw new Error(m);
    };

    it('без имени берётся defaultProfile, общие поля наследуются', () => {
        const cfg = resolveProfile(raw(), null, boom);
        expect(cfg.profileName).toBe('playground');
        expect(cfg.maxIterations).toBe(10);
        expect(cfg.phases).toEqual([{ milestone: 'M', branch: 'b' }]);
    });

    it('пустой профиль playground не меняет общие значения (регресса нет)', () => {
        const cfg = resolveProfile(raw(), 'playground', boom);
        expect(cfg.blockedHealAttempts).toBe(3);
    });

    it('профиль переопределяет только свою дельту, остальное — из common', () => {
        const cfg = resolveProfile(raw(), 'prod', boom);
        expect(cfg.blockedHealAttempts).toBe(0);
        expect(cfg.maxIterations).toBe(10);
        expect(cfg.modelRouting.labels.high).toBe('opus');
    });

    it('явное имя важнее defaultProfile', () => {
        expect(resolveProfile(raw(), 'prod', boom).profileName).toBe('prod');
    });

    it('резолв одного профиля не протекает в соседний (общий блок не мутируется)', () => {
        const cfgRaw = raw();
        resolveProfile(cfgRaw, 'prod', boom);
        expect(resolveProfile(cfgRaw, 'playground', boom).blockedHealAttempts).toBe(3);
    });

    // Fail-closed: раннер с bypassPermissions не имеет права угадывать режим.
    it('неизвестный профиль → стоп, в сообщении перечислены доступные', () => {
        expect(() => resolveProfile(raw(), 'staging', boom)).toThrow(/staging.*playground, prod/s);
    });

    it('нет defaultProfile и профиль не задан → стоп, а не молчаливый playground', () => {
        const cfg = raw();
        delete cfg.defaultProfile;
        expect(() => resolveProfile(cfg, null, boom)).toThrow(/defaultProfile/);
    });

    it('нет блока common → стоп', () => {
        expect(() => resolveProfile({ profiles: { p: {} } }, 'p', boom)).toThrow(/common/);
    });

    it('нет блока profiles → стоп', () => {
        expect(() => resolveProfile({ common: {} }, null, boom)).toThrow(/profiles/);
    });

    it('profiles пуст → стоп', () => {
        expect(() => resolveProfile({ common: {}, profiles: {} }, null, boom)).toThrow(/пуст/);
    });

    it('профиль не объект (массив/строка) → стоп', () => {
        expect(() => resolveProfile({ common: {}, profiles: { p: [] } }, 'p', boom)).toThrow(
            /не объект/,
        );
    });

    it('конфиг не объект (null/массив) → стоп', () => {
        expect(() => resolveProfile(null, null, boom)).toThrow(/объект/);
        expect(() => resolveProfile([], null, boom)).toThrow(/объект/);
    });

    it('имя профиля из прототипа (constructor/toString) не считается существующим', () => {
        expect(() => resolveProfile(raw(), 'constructor', boom)).toThrow(/Неизвестный профиль/);
    });

    // Контракт монитора: failFn может НЕ бросать, а вернуть sentinel (null) —
    // resolveProfile обязан вернуть его сразу, не продолжая работу с кривым raw.
    it('с невыбрасывающим failFn возвращает его результат, а не падает дальше по коду', () => {
        const softFail = () => null;
        expect(resolveProfile(null, null, softFail)).toBe(null);
        expect(resolveProfile({ common: {} }, null, softFail)).toBe(null);
        expect(resolveProfile(raw(), 'staging', softFail)).toBe(null);
    });
});

describe('parseProfileFlag — выбор профиля из argv (#72)', () => {
    const boom = (m) => {
        throw new Error(m);
    };

    it('--profile <name> отдаёт имя', () => {
        expect(parseProfileFlag(['--profile', 'prod'], boom)).toBe('prod');
    });

    it('--profile=<name> отдаёт имя', () => {
        expect(parseProfileFlag(['--profile=prod'], boom)).toBe('prod');
    });

    it('без флага → null: решать будет defaultProfile конфига', () => {
        expect(parseProfileFlag(['--once', '--dry-run'], boom)).toBe(null);
    });

    it('имя не путается с соседними флагами', () => {
        expect(parseProfileFlag(['--dry-run', '--profile', 'prod', '--once'], boom)).toBe('prod');
    });

    // Оборванная команда не должна тихо уводить в playground.
    it('--profile без имени → стоп', () => {
        expect(() => parseProfileFlag(['--profile'], boom)).toThrow(/требует имя/);
    });

    it('--profile перед другим флагом → стоп, а не имя "--once"', () => {
        expect(() => parseProfileFlag(['--profile', '--once'], boom)).toThrow(/требует имя/);
    });

    it('--profile= с пустым значением → стоп', () => {
        expect(() => parseProfileFlag(['--profile='], boom)).toThrow(/без имени/);
    });

    // Дубль с разными именами: «кто победит» нельзя решать порядком веток парсера —
    // это тихий уход не в тот профиль. Только стоп.
    it('дубль флага в разных формах → стоп', () => {
        expect(() => parseProfileFlag(['--profile', 'prod', '--profile=playground'], boom)).toThrow(
            /указан 2 раза/,
        );
    });

    it('дубль флага в одной форме → стоп, даже с одинаковым именем', () => {
        expect(() => parseProfileFlag(['--profile', 'prod', '--profile', 'prod'], boom)).toThrow(
            /указан 2 раза/,
        );
    });

    it('связка с резолвом: флаг важнее defaultProfile', () => {
        const raw = {
            defaultProfile: 'playground',
            common: { maxTurns: 200 },
            profiles: { playground: {}, prod: { maxTurns: 50 } },
        };
        const name = parseProfileFlag(['--profile', 'prod'], boom);
        const cfg = resolveProfile(raw, name, boom);
        expect(cfg.profileName).toBe('prod');
        expect(cfg.maxTurns).toBe(50);
    });

    it('связка с резолвом: неизвестное имя из флага → стоп', () => {
        const raw = { defaultProfile: 'playground', common: {}, profiles: { playground: {} } };
        const name = parseProfileFlag(['--profile', 'staging'], boom);
        expect(() => resolveProfile(raw, name, boom)).toThrow(/Неизвестный профиль/);
    });
});

describe('боевой ralph.config.json — профили playground/prod (#73)', () => {
    // Читаем НАСТОЯЩИЙ конфиг, а не синтетику: смысл issue в том, что прод-значения
    // лежат в файле, а не в дефолтах кода, и что playground не съехал.
    const raw = JSON.parse(fs.readFileSync('.claude/ralph/ralph.config.json', 'utf-8'));
    const boom = (m) => {
        throw new Error(m);
    };

    it('без флага резолвится playground', () => {
        expect(resolveProfile(raw, null, boom).profileName).toBe('playground');
    });

    it('playground сохраняет прежнее поведение: крутилки равны дефолтам кода', () => {
        const cfg = resolveProfile(raw, 'playground', boom);
        // Ровно те значения, что стояли в `cfg.X ?? N` до переезда в конфиг.
        expect(cfg.blockedHealAttempts).toBe(3);
        expect(cfg.gateHealAttempts).toBe(2);
        expect(cfg.apiLimitMaxWaits).toBe(3);
    });

    // #216: prod больше НЕ выключает разбор blocked (был blockedHealAttempts: 0) —
    // блокер ревью, устранённый правками, снимается сам после чистого повторного ревью,
    // а не ждёт человека. Значение наследуется из common (дефолт 3), профиль его не дублирует.
    it('prod: blocked-разбор включён — наследует лимит из common (дефолт 3)', () => {
        expect(resolveProfile(raw, 'prod', boom).blockedHealAttempts).toBe(3);
    });

    it('prod наследует всё остальное из common, не дублируя его', () => {
        const pg = resolveProfile(raw, 'playground', boom);
        const prod = resolveProfile(raw, 'prod', boom);
        expect(prod.modelRouting).toEqual(pg.modelRouting);
        expect(prod.review).toEqual(pg.review);
        expect(prod.phases).toEqual(pg.phases);
        expect(prod.authorAllowlist).toEqual(pg.authorAllowlist);
        expect(prod.blockedHealAttempts).toEqual(pg.blockedHealAttempts);
        // #216: дельта prod пуста — разбор blocked теперь идёт по общим правилам, отличие
        // прода от playground держит код по profileName (толстый гейт, TG, стоп на деплой).
        expect(Object.keys(raw.profiles.prod)).toEqual([]);
    });
});

describe('monitorAlive — жив ли процесс монитора (#74)', () => {
    it('сигнал 0 прошёл → процесс жив', () => {
        expect(monitorAlive(1234, () => undefined)).toBe(true);
    });

    it('сигнал 0 бросил (нет такого процесса) → мёртв', () => {
        expect(
            monitorAlive(1234, () => {
                throw new Error('ESRCH');
            }),
        ).toBe(false);
    });

    it('пустой/нулевой pid → мёртв, без вызова kill', () => {
        const kill = vi.fn();
        expect(monitorAlive(0, kill)).toBe(false);
        expect(monitorAlive(undefined, kill)).toBe(false);
        expect(kill).not.toHaveBeenCalled();
    });
});

describe('isMonitorProcess — за pid действительно monitor.js (#74)', () => {
    it('в /proc/<pid>/cmdline есть monitor.js → это наш монитор', () => {
        const readFn = vi.fn(() => 'node\0.claude/ralph/monitor.js\0');
        expect(isMonitorProcess(99, readFn)).toBe(true);
        expect(readFn).toHaveBeenCalledWith('/proc/99/cmdline', 'utf-8');
    });

    // ОС переиспользовала pid: живой процесс есть, но это не монитор — kill нельзя.
    it('чужой процесс под тем же pid → false', () => {
        expect(isMonitorProcess(99, () => 'nginx\0-g\0daemon off;\0')).toBe(false);
    });

    it('процесса нет (чтение /proc упало) → false', () => {
        expect(
            isMonitorProcess(99, () => {
                throw new Error('ENOENT');
            }),
        ).toBe(false);
    });

    it('пустой/нулевой pid → false без чтения /proc', () => {
        const readFn = vi.fn();
        expect(isMonitorProcess(0, readFn)).toBe(false);
        expect(isMonitorProcess(undefined, readFn)).toBe(false);
        expect(readFn).not.toHaveBeenCalled();
    });
});

describe('startMonitor — авто-спавн панели прогресса (#74)', () => {
    const deps = (over = {}) => ({
        spawnFn: vi.fn(() => ({ pid: 4242, unref: vi.fn(), on: vi.fn() })),
        logFn: vi.fn(),
        readPidFn: () => 0,
        writePidFn: vi.fn(),
        openOutFn: () => 7,
        closeOutFn: vi.fn(),
        aliveFn: () => false,
        isMonitorFn: () => false,
        ...over,
    });

    it('спавнит monitor.js детачнутым, вывод — в файл, pid сохраняется', () => {
        const d = deps();
        const child = startMonitor(d);

        expect(child.pid).toBe(4242);
        const [bin, argv, opts] = d.spawnFn.mock.calls[0];
        expect(bin).toBe(process.execPath);
        expect(argv[0]).toMatch(/monitor\.js$/);
        expect(opts.detached).toBe(true);
        // stdout и stderr — в открытый дескриптор файла, stdin не нужен.
        expect(opts.stdio).toEqual(['ignore', 7, 7]);
        expect(d.writePidFn).toHaveBeenCalledWith(4242);
    });

    // Правка по ревью PR #127: без прокидывания профиля панель резолвила бы
    // defaultProfile и показывала чужой режим, когда раннер идёт из --profile prod.
    it('профиль раннера передаётся монитору через argv', () => {
        const d = deps({ profile: 'prod' });
        startMonitor(d);
        const [, argv] = d.spawnFn.mock.calls[0];
        expect(argv.slice(1)).toEqual(['--profile', 'prod']);
    });

    it('без профиля (прямой вызов) монитор спавнится без лишних флагов', () => {
        const d = deps();
        startMonitor(d);
        const [, argv] = d.spawnFn.mock.calls[0];
        expect(argv).toHaveLength(1);
    });

    it('unref: раннер не держится в памяти из-за монитора', () => {
        const unref = vi.fn();
        startMonitor(deps({ spawnFn: () => ({ pid: 1, unref, on: vi.fn() }) }));
        expect(unref).toHaveBeenCalled();
    });

    // Родитель обязан закрыть СВОЮ копию дескриптора monitor.out: ребёнок при spawn
    // получил dup, а копия раннера иначе висела бы открытой весь ночной прогон.
    it('дескриптор monitor.out закрывается в родителе после спавна', () => {
        const d = deps();
        startMonitor(d);
        expect(d.closeOutFn).toHaveBeenCalledWith(7);
    });

    it('монитор от прошлого прогона живой → подхватываем его, второй не поднимаем', () => {
        const d = deps({
            readPidFn: () => 99,
            aliveFn: (pid) => pid === 99,
            isMonitorFn: (pid) => pid === 99,
        });
        // Возвращаем сироту как {pid} — stopMonitor заглушит его при выходе раннера.
        expect(startMonitor(d)).toEqual({ pid: 99 });
        expect(d.spawnFn).not.toHaveBeenCalled();
    });

    // pid из файла жив, но это уже ЧУЖОЙ процесс (ОС переиспользовала номер):
    // подхватывать нельзя — спавним свой монитор.
    it('живой pid из файла, но не monitor.js → спавним свой', () => {
        const d = deps({ readPidFn: () => 99, aliveFn: () => true, isMonitorFn: () => false });
        expect(startMonitor(d).pid).toBe(4242);
        expect(d.spawnFn).toHaveBeenCalled();
    });

    it('pid-файл от убитого процесса не мешает: спавним заново', () => {
        const d = deps({ readPidFn: () => 99, aliveFn: () => false });
        expect(startMonitor(d).pid).toBe(4242);
        expect(d.spawnFn).toHaveBeenCalled();
    });

    it('нечитаемый pid-файл не ломает старт', () => {
        const d = deps({
            readPidFn: () => {
                throw new Error('ENOENT');
            },
        });
        expect(startMonitor(d).pid).toBe(4242);
    });

    // Монитор — удобство: его падение не имеет права ронять ночной прогон.
    it('упавший спавн → null и предупреждение, без исключения наружу', () => {
        const d = deps({
            spawnFn: () => {
                throw new Error('EACCES');
            },
        });
        expect(startMonitor(d)).toBe(null);
        expect(d.logFn.mock.calls.join(' ')).toMatch(/не запустился/);
        // Открытый под спавн дескриптор не течёт и на пути ошибки.
        expect(d.closeOutFn).toHaveBeenCalledWith(7);
    });

    // spawn может упасть и АСИНХРОННО (событие 'error'); без слушателя это был бы
    // uncaughtException — упал бы весь раннер, а не только монитор.
    it("асинхронная ошибка spawn ('error') логируется, а не роняет раннер", () => {
        const on = vi.fn();
        const d = deps({ spawnFn: () => ({ pid: 1, unref: vi.fn(), on }) });
        startMonitor(d);

        const errorHandler = on.mock.calls.find(([event]) => event === 'error')?.[1];
        expect(errorHandler).toBeTypeOf('function');
        expect(() => errorHandler(new Error('EMFILE'))).not.toThrow();
        expect(d.logFn.mock.calls.join(' ')).toMatch(/EMFILE/);
    });
});

describe('stopMonitor — остановка монитора при выходе раннера (#74)', () => {
    // isMonitorFn: () => true — «за pid реально monitor.js», путь до kill открыт.
    it('глушит ГРУППУ процессов (минус pid) и чистит pid-файл', () => {
        const killFn = vi.fn();
        const rmPidFn = vi.fn();
        expect(
            stopMonitor(
                { pid: 4242 },
                { killFn, rmPidFn, logFn: vi.fn(), isMonitorFn: () => true },
            ),
        ).toBe(true);
        expect(killFn).toHaveBeenCalledWith(-4242, 'SIGTERM');
        expect(rmPidFn).toHaveBeenCalled();
    });

    it('если группу убить не вышло — падаем обратно на одиночный pid', () => {
        const calls = [];
        const killFn = vi.fn((pid) => {
            calls.push(pid);
            if (pid < 0) throw new Error('EPERM');
        });
        stopMonitor(
            { pid: 7 },
            { killFn, rmPidFn: vi.fn(), logFn: vi.fn(), isMonitorFn: () => true },
        );
        expect(calls).toEqual([-7, 7]);
    });

    it('монитора нет (не поднялся) → тихо ничего не делаем', () => {
        const killFn = vi.fn();
        expect(stopMonitor(null, { killFn, logFn: vi.fn() })).toBe(false);
        expect(killFn).not.toHaveBeenCalled();
    });

    // Монитор умер сам, ОС отдала его pid чужому процессу — kill(-pid) снёс бы
    // невиновную группу. Сверка перед kill обязана это отсечь; pid-файл всё равно чистим.
    it('pid уже не monitor.js (переиспользован ОС) → kill не зовём, pid-файл чистим', () => {
        const killFn = vi.fn();
        const rmPidFn = vi.fn();
        expect(
            stopMonitor(
                { pid: 4242 },
                { killFn, rmPidFn, logFn: vi.fn(), isMonitorFn: () => false },
            ),
        ).toBe(false);
        expect(killFn).not.toHaveBeenCalled();
        expect(rmPidFn).toHaveBeenCalled();
    });

    it('мёртвый процесс: ошибка kill не пробрасывается наружу', () => {
        expect(() =>
            stopMonitor(
                { pid: 5 },
                {
                    killFn: () => {
                        throw new Error('ESRCH');
                    },
                    rmPidFn: vi.fn(),
                    logFn: vi.fn(),
                    isMonitorFn: () => true,
                },
            ),
        ).not.toThrow();
    });
});

describe('adoptMonitor — подбор монитора-сироты от прошлого прогона (#74)', () => {
    it('живой monitor.js по pid-файлу → подхватываем, а не плодим второй', () => {
        const got = adoptMonitor({
            logFn: vi.fn(),
            readPidFn: () => 77,
            aliveFn: (pid) => pid === 77,
            isMonitorFn: (pid) => pid === 77,
        });
        expect(got).toEqual({ pid: 77 });
    });

    it('pid мёртв → сироты нет', () => {
        expect(adoptMonitor({ logFn: vi.fn(), readPidFn: () => 77, aliveFn: () => false })).toBe(
            null,
        );
    });

    // ОС переиспользует pid: живой процесс по этому номеру может быть чужим.
    it('pid жив, но за ним не monitor.js → не подхватываем (иначе убьём чужое)', () => {
        expect(
            adoptMonitor({
                logFn: vi.fn(),
                readPidFn: () => 77,
                aliveFn: () => true,
                isMonitorFn: () => false,
            }),
        ).toBe(null);
    });

    it('нет pid-файла → сироты нет, без исключения', () => {
        expect(
            adoptMonitor({
                logFn: vi.fn(),
                readPidFn: () => {
                    throw new Error('ENOENT');
                },
            }),
        ).toBe(null);
    });

    // Сирота от прогона в ДРУГОМ профиле показывал бы чужие phases — та же дыра,
    // что спавн без --profile (ревью PR #127): не подхватываем, а глушим.
    it('сирота в чужом профиле → глушим и не подхватываем', () => {
        const killFn = vi.fn();
        const rmPidFn = vi.fn();
        expect(
            adoptMonitor({
                logFn: vi.fn(),
                readPidFn: () => 77,
                aliveFn: () => true,
                isMonitorFn: () => true,
                readCmdlineFn: () => 'node\0.claude/ralph/monitor.js\0--profile\0playground\0',
                profile: 'prod',
                killFn,
                rmPidFn,
            }),
        ).toBe(null);
        // Глушим группу сироты и чистим pid-файл — как штатный stopMonitor.
        expect(killFn).toHaveBeenCalledWith(-77, 'SIGTERM');
        expect(rmPidFn).toHaveBeenCalled();
    });

    it('сирота в том же профиле → подхватываем', () => {
        const killFn = vi.fn();
        expect(
            adoptMonitor({
                logFn: vi.fn(),
                readPidFn: () => 77,
                aliveFn: () => true,
                isMonitorFn: () => true,
                readCmdlineFn: () => 'node\0.claude/ralph/monitor.js\0--profile\0prod\0',
                profile: 'prod',
                killFn,
            }),
        ).toEqual({ pid: 77 });
        expect(killFn).not.toHaveBeenCalled();
    });

    // Старый сирота без --profile в cmdline резолвил бы defaultProfile — это не
    // обязательно профиль текущего раннера, подхватывать нельзя.
    it('сирота без --profile в cmdline при заданном ожидании → глушим', () => {
        const killFn = vi.fn();
        expect(
            adoptMonitor({
                logFn: vi.fn(),
                readPidFn: () => 77,
                aliveFn: () => true,
                isMonitorFn: () => true,
                readCmdlineFn: () => 'node\0.claude/ralph/monitor.js\0',
                profile: 'prod',
                killFn,
                rmPidFn: vi.fn(),
            }),
        ).toBe(null);
        expect(killFn).toHaveBeenCalledWith(-77, 'SIGTERM');
    });

    it('profile не задан (прямой вызов) → сверки нет, подхватываем как раньше', () => {
        expect(
            adoptMonitor({
                logFn: vi.fn(),
                readPidFn: () => 77,
                aliveFn: () => true,
                isMonitorFn: () => true,
                readCmdlineFn: () => {
                    throw new Error('не должен читаться');
                },
            }),
        ).toEqual({ pid: 77 });
    });
});

describe('ensureMonitorAlive — взаимный контроль раннер↔монитор на каждой итерации (#151)', () => {
    it('монитор жив и это monitor.js → ничего не переподнимаем', () => {
        const startMonitorFn = vi.fn();
        const logFn = vi.fn();
        expect(
            ensureMonitorAlive({
                logFn,
                readPidFn: () => 77,
                aliveFn: (pid) => pid === 77,
                isMonitorFn: (pid) => pid === 77,
                startMonitorFn,
            }),
        ).toBe(null);
        expect(startMonitorFn).not.toHaveBeenCalled();
        expect(logFn).not.toHaveBeenCalled();
    });

    it('монитор мёртв → переподнимаем через startMonitor и пишем в лог', () => {
        const startMonitorFn = vi.fn(() => ({ pid: 4242 }));
        const logFn = vi.fn();
        const got = ensureMonitorAlive({
            logFn,
            readPidFn: () => 77,
            aliveFn: () => false,
            isMonitorFn: () => false,
            startMonitorFn,
            profile: 'prod',
            configPath: '/tmp/ralph.config.json',
        });
        expect(got).toEqual({ pid: 4242 });
        // deps прокидываются в startMonitor целиком (сквозная инжекция фейков во
        // внутренний adoptMonitor) — profile/configPath доезжают в их составе.
        expect(startMonitorFn).toHaveBeenCalledWith(
            expect.objectContaining({
                profile: 'prod',
                configPath: '/tmp/ralph.config.json',
            }),
        );
        expect(logFn).toHaveBeenCalledTimes(1);
        expect(logFn.mock.calls[0][0]).toMatch(/не отвечает/);
    });

    // ОС переиспользует pid: живой процесс по этому номеру может оказаться чужим —
    // тот же класс проверки, что и в adoptMonitor/stopMonitor.
    it('pid жив, но за ним не monitor.js (переиспользованный pid) → считаем мёртвым, переподнимаем', () => {
        const startMonitorFn = vi.fn(() => ({ pid: 4242 }));
        const got = ensureMonitorAlive({
            logFn: vi.fn(),
            readPidFn: () => 77,
            aliveFn: () => true,
            isMonitorFn: () => false,
            startMonitorFn,
        });
        expect(got).toEqual({ pid: 4242 });
        expect(startMonitorFn).toHaveBeenCalled();
    });

    it('нет pid-файла (readPidFn кидает) → считаем мёртвым, переподнимаем без исключения', () => {
        const startMonitorFn = vi.fn(() => ({ pid: 4242 }));
        expect(
            ensureMonitorAlive({
                logFn: vi.fn(),
                readPidFn: () => {
                    throw new Error('ENOENT');
                },
                startMonitorFn,
            }),
        ).toEqual({ pid: 4242 });
        expect(startMonitorFn).toHaveBeenCalled();
    });

    // #153: критерий готовности фазы — «симуляция: монитор убит между итерациями →
    // к следующей итерации поднят новый, pid-файл обновлён». readPidFn/aliveFn читают
    // общую переменную pidFile — она играет роль pid-файла на диске; startMonitorFn
    // (как и настоящий startMonitor) перезаписывает её новым pid при переподнятии.
    // Побочки — только через DI (никакого реального fs/spawn), поэтому под
    // RALPH_NO_SIDE_EFFECTS=1 предохранитель guardSideEffect тут молчит.
    it('симуляция: монитор убит между итерациями → следующая итерация поднимает новый, pid-файл обновлён', () => {
        let pidFile = 111;
        let alive = true;
        const readPidFn = () => pidFile;
        const aliveFn = (pid) => pid === pidFile && alive;
        const isMonitorFn = (pid) => pid === pidFile;
        const startMonitorFn = vi.fn(() => {
            pidFile = 222; // тот же эффект, что у настоящего startMonitor: writePidFn
            alive = true;
            return { pid: pidFile };
        });
        const logFn = vi.fn();
        const iteration = () =>
            ensureMonitorAlive({ logFn, readPidFn, aliveFn, isMonitorFn, startMonitorFn });

        // Итерация 1: монитор жив — раннер его не трогает.
        expect(iteration()).toBe(null);
        expect(startMonitorFn).not.toHaveBeenCalled();
        expect(pidFile).toBe(111);

        // Монитор убит МЕЖДУ итерациями (kill -9, OOM) — pid-файл ещё старый.
        alive = false;

        // Итерация 2: смерть обнаружена, монитор переподнят, pid-файл обновлён.
        expect(iteration()).toEqual({ pid: 222 });
        expect(startMonitorFn).toHaveBeenCalledTimes(1);
        expect(pidFile).toBe(222);

        // Итерация 3: новый монитор уже жив по обновлённому pid — второй раз не поднимаем.
        expect(iteration()).toBe(null);
        expect(startMonitorFn).toHaveBeenCalledTimes(1);
    });

    // MONITOR_PID один на все профили: монитор соседнего профиля (playground рядом с
    // prod), перезаписавший файл, alive+monitor.js прошёл бы, но НАШ монитор при этом
    // мёртв. Без профильной сверки раннер всю ночь считал бы чужой процесс своим и не
    // переподнял бы собственный — паритет с adoptMonitor закрывает эту тишину.
    it('pid жив monitor.js, но ЧУЖОГО профиля → свой считаем мёртвым, переподнимаем', () => {
        const startMonitorFn = vi.fn(() => ({ pid: 4242 }));
        const got = ensureMonitorAlive({
            logFn: vi.fn(),
            readPidFn: () => 77,
            aliveFn: () => true,
            isMonitorFn: () => true,
            readCmdlineFn: () => 'node\0.claude/ralph/monitor.js\0--profile\0playground\0',
            profile: 'prod',
            startMonitorFn,
        });
        expect(got).toEqual({ pid: 4242 });
        expect(startMonitorFn).toHaveBeenCalled();
    });

    it('pid жив monitor.js НАШЕГО профиля → ничего не переподнимаем', () => {
        const startMonitorFn = vi.fn();
        expect(
            ensureMonitorAlive({
                logFn: vi.fn(),
                readPidFn: () => 77,
                aliveFn: () => true,
                isMonitorFn: () => true,
                readCmdlineFn: () => 'node\0.claude/ralph/monitor.js\0--profile\0prod\0',
                profile: 'prod',
                startMonitorFn,
            }),
        ).toBe(null);
        expect(startMonitorFn).not.toHaveBeenCalled();
    });

    // Стык с main(): при переподнятии монитора посреди прогона exit-хендлер обязан
    // заглушить ИМЕННО нового ребёнка. #153 проверяет петлю изолированно, здесь —
    // связку «обёртка обновляет захваченную ссылку → stopMonitor глушит новый pid, а
    // не удаляет pid-файл живого». Без фикса exit звал бы stopMonitor(мёртвый старый),
    // тот через isMonitorProcess=false ушёл бы в ветку rmPidFn и снёс бы pid-файл, где
    // уже записан pid НОВОГО монитора — новый остался бы вечным сиротой.
    it('#151: монитор переподнят посреди прогона → exit глушит НОВОГО, ссылка обновлена', () => {
        // Связка main(): захваченная ссылка monitor + обёртка, обновляющая её.
        let monitor = { pid: 111 }; // старый монитор, поднятый на старте
        const ensureWrapped = (o) => {
            const fresh = ensureMonitorAlive(o);
            if (fresh) monitor = fresh;
            return fresh;
        };

        // Старый (111) умер между итерациями → ensureMonitorAlive поднимает новый (222).
        ensureWrapped({
            logFn: vi.fn(),
            readPidFn: () => 111,
            aliveFn: () => false,
            isMonitorFn: () => false,
            startMonitorFn: () => ({ pid: 222 }),
        });
        expect(monitor).toEqual({ pid: 222 }); // ссылка exit-хендлера обновилась на нового

        // exit-хендлер зовёт stopMonitor(monitor) — с фиксом это новый (222), живой.
        const killFn = vi.fn();
        const rmPidFn = vi.fn();
        stopMonitor(monitor, {
            killFn,
            rmPidFn,
            isMonitorFn: (pid) => pid === 222, // живой по этому pid — именно новый монитор
            logFn: vi.fn(),
        });
        expect(killFn).toHaveBeenCalledWith(-222, 'SIGTERM'); // глушим нового, а не сиротим
    });
});

// ── Изоляция раннера в worktree: сценарии и мердж-инварианты (#79) ────────────
// Отдельные describe'ы #76/#77/#78 проверяют КАЖДЫЙ ветковый хелпер по-функции.
// Здесь — два поперечных гаранта, которые из этих поштучных проверок не видны:
//   1) Сценарий: правки/коммиты человека в его главном дереве во время работы loop
//      не роняют ensureClean раннера (критерий #79) — моделируем мир из двух
//      worktree, где `git status --porcelain` отдаёт состояние ТОЛЬКО своего дерева.
//   2) Мердж-инварианты: склеиваем РЕАЛЬНЫЕ checksGreen + tryMergePhase (а не мок
//      вместо checksGreen, как в #77) и на всей последовательности git-команд
//      закрепляем, что раннер НИКОГДА не занимает именованную ветку и не двигает
//      ref человека — ходит строго детачем (PR-голова / origin/main).
describe('Изоляция раннера в worktree — сценарии и мердж-инварианты (#79)', () => {
    // Любая git-команда, которая заняла бы именованную ветку или тронула бы дерево/
    // ref человека. Раннер в worktree-модели не имеет права ни на одну из них: main
    // и ветку фазы держат ЧУЖИЕ worktree (человек / кодер-сессии), git не отдаст один
    // ref двум деревьям, а сам факт checkout/merge/reset в общий рабочий каталог
    // утащил бы за собой правки человека — ровно то, от чего затевалась изоляция (#76).
    const FORBIDDEN_GIT = [
        // checkout НЕ через --detach = занятие именованной ветки (в т.ч. `git checkout main`).
        /^git checkout (?!--detach\b)/,
        /^git pull\b/,
        /^git merge\b/,
        /^git reset\b/,
        /^git branch\b/,
        /^git switch\b/,
        /^git update-ref\b/,
        /^git commit\b/,
        /^git push\b/, // пуш ветки — забота кодер-сессии, не гейта раннера
    ];
    const assertNoForbiddenGit = (cmds) => {
        for (const cmd of cmds.filter((c) => c.startsWith('git '))) {
            for (const re of FORBIDDEN_GIT) {
                expect(re.test(cmd), `запрещённая git-команда в дереве раннера: "${cmd}"`).toBe(
                    false,
                );
            }
        }
    };

    describe('assertNoForbiddenGit — самопроверка гарда инвариантов', () => {
        // Гард ценен только если реально ловит нарушение и пропускает детач. Проверяем
        // обе грани, чтобы «зелёный инвариант» ниже не оказался пустым обещанием.
        it('пропускает детачи и служебные команды раннера', () => {
            expect(() =>
                assertNoForbiddenGit([
                    "git fetch origin 'feature/m1'",
                    'git checkout --detach ' + 'a'.repeat(40),
                    'git checkout --detach origin/main',
                    "git rev-parse --verify --quiet 'refs/heads/feature/m1'",
                    'git status --porcelain',
                    'npm run build',
                ]),
            ).not.toThrow();
        });

        it.each([
            'git checkout main',
            'git checkout feature/m1',
            'git switch main',
            'git pull --ff-only',
            'git merge origin/main',
            'git reset --hard origin/main',
            'git branch -f main origin/main',
            'git push origin feature/m1',
        ])('ловит нарушение: %s', (bad) => {
            expect(() => assertNoForbiddenGit([bad])).toThrow();
        });
    });

    describe('сценарий: правки человека в его main во время loop не роняют ensureClean раннера', () => {
        // Мир из двух worktree общего репозитория: у человека — дерево на ветке main,
        // у раннера — выделенное дерево (#76). Ключевое свойство git: `git status
        // --porcelain` отдаёт состояние ИНДЕКСА/РАБОЧЕГО КАТАЛОГА того worktree, из
        // которого запущен. Раннер после process.chdir (#76) зовёт git в своём дереве,
        // поэтому его ensureClean читает только состояние раннера — что бы человек ни
        // творил у себя. Живой git тут не поднимаем осознанно (см. коммент к #78:
        // под pre-push-хуком GIT_DIR в env уводит подпроцессный git на настоящий репо).
        const mkTwoWorktrees = () => {
            const runner = { porcelain: '' }; // выделенное дерево раннера
            const human = { porcelain: '' }; // дерево человека на ветке main (для наглядности)
            // shFn раннера: git исполняется в дереве раннера, видит только его состояние.
            const runnerSh = (cmd) => {
                if (cmd === 'git status --porcelain') return runner.porcelain;
                return '';
            };
            return { runner, human, runnerSh };
        };

        it('человек редактирует, затем коммитит в main посреди прогона — раннер зелёный на каждой проверке', () => {
            const w = mkTwoWorktrees();
            const logs = [];
            const clean = (ctx) =>
                ensureClean(ctx, { shFn: w.runnerSh, logFn: (m) => logs.push(m) });

            // Итерация 1: раннер проверяет чистоту перед сессией — своё дерево пусто.
            expect(clean('итерация 1')).toBe(true);

            // Человек правит файлы в своём рабочем дереве (main) во время прогона.
            w.human.porcelain = ' M src/human-edit.ts\n?? human-scratch.txt';
            // Итерация 2: правки человека в дерево раннера не попали — по-прежнему чисто.
            expect(clean('итерация 2')).toBe(true);

            // Человек закоммитил свои правки в main (его дерево снова чистое, но дело не
            // в этом — раннера оно не касалось ни грязным, ни после коммита).
            w.human.porcelain = '';
            // Гейт мерджа: раннер снова проверяет чистоту — зелено.
            expect(clean('гейт мерджа')).toBe(true);

            // За весь сценарий ни одной жалобы на грязь.
            expect(logs).toEqual([]);
        });

        it('контроль (не-вакуумность): грязь в дереве САМОГО раннера ensureClean всё-таки ловит', () => {
            // Если бы изоляция была «всегда true», тест выше ничего не гарантировал.
            // Убитая по maxTurns сессия оставила полу-работу в дереве раннера —
            // ensureClean обязан её увидеть и остановить следующую итерацию.
            const w = mkTwoWorktrees();
            w.runner.porcelain = ' M src/runner-half-work.ts';
            const logs = [];
            expect(ensureClean('итерация', { shFn: w.runnerSh, logFn: (m) => logs.push(m) })).toBe(
                false,
            );
            expect(logs.join('\n')).toMatch(/Грязное рабочее дерево/);
        });
    });

    describe('мердж-инварианты: реальные checksGreen + tryMergePhase, склеенные одним git-рекордером', () => {
        const SHA_HEAD = 'c'.repeat(40); // голова PR == локальная ветка фазы
        const phase = { milestone: 'M1', branch: 'feature/m1' };

        // Единый рекордер git-команд для ОБЕИХ функций: checksGreen (внутренние deps)
        // и tryMergePhase пишут в один shCmds — так инвариант проверяется на ПОЛНОЙ
        // хореографии гейта, а не по частям. shImpl задаёт поведение конкретных команд.
        const mkWiring = ({ shImpl } = {}) => {
            const shCmds = [];
            const shFn = (cmd) => {
                shCmds.push(cmd);
                if (shImpl) {
                    const r = shImpl(cmd);
                    if (r !== undefined) return r;
                }
                if (cmd.startsWith('git rev-parse --verify')) return SHA_HEAD; // локалка == PR
                return '';
            };
            const deps = {
                dry: false,
                shFn,
                logFn: () => {},
                ensureCleanFn: () => true,
                findOpenPrFn: () => ({ number: 5, labels: [] }),
                // РЕАЛЬНЫЙ checksGreen, пишущий в тот же shCmds и видящий ту же PR-голову.
                checksGreenFn: (branch, prNumber) =>
                    checksGreen(branch, prNumber, {
                        shFn,
                        ghJsonFn: () => ({ headRefOid: SHA_HEAD }),
                        logFn: () => {},
                        parkFn: () => shFn('git checkout --detach origin/main'),
                        syncDepsFn: () => {}, // не гоняем реальный npm ci в инвариант-тесте
                    }),
                phaseMergedFn: () => false,
                sleepFn: () => {},
                parkFn: () => shFn('git checkout --detach origin/main'),
                getLastRedCheckFn: () => null,
            };
            return { shCmds, deps };
        };

        it('зелёный гейт целиком: merged, и ни одной запрещённой git-команды на всём пути', () => {
            const { shCmds, deps } = mkWiring();
            expect(tryMergePhase(phase, deps)).toBe('merged');

            // Позитив: раннер ходил строго детачем — на PR-голову и на origin/main.
            expect(shCmds).toContain("git fetch origin 'feature/m1'");
            expect(shCmds).toContain(`git checkout --detach ${SHA_HEAD}`);
            expect(shCmds).toContain('git fetch origin main');
            expect(shCmds).toContain('git checkout --detach origin/main');
            // #SiaTz: мердж привязан к ТОЙ ЖЕ голове, что прогнал реальный checksGreen —
            // --match-head-commit закрывает TOCTOU-окно между чеками и мерджем.
            expect(shCmds).toContain(
                `gh pr merge '5' --squash --delete-branch --match-head-commit ${SHA_HEAD}`,
            );

            // Инвариант: ни одного занятия именованной ветки / правки дерева человека.
            assertNoForbiddenGit(shCmds);
        });

        it('локальную ветку фазы раннер только ЧИТАЕТ (rev-parse --verify), никогда не двигает', () => {
            const { shCmds, deps } = mkWiring();
            expect(tryMergePhase(phase, deps)).toBe('merged');
            // Сверка HEAD==PR идёт read-only обращением к ref — не update-ref/branch -f.
            expect(shCmds).toContain("git rev-parse --verify --quiet 'refs/heads/feature/m1'");
            expect(shCmds.some((c) => /^git (update-ref|branch)\b/.test(c))).toBe(false);
        });

        it('worktree-ограничение git (main/ветка заняты чужим деревом) хореографию НЕ ломает — раннер её и не трогает', () => {
            // Моделируем реальный отказ git: попытку занять именованную ветку, уже
            // выданную другому worktree, git отвергает fatal-ошибкой. Раннер обязан
            // никогда на это не натыкаться — весь путь идёт детачем, поэтому throw
            // ниже не срабатывает и гейт доходит до merged.
            const { shCmds, deps } = mkWiring({
                shImpl: (cmd) => {
                    if (/^git checkout (?!--detach\b)/.test(cmd) || cmd.startsWith('git switch')) {
                        throw new Error(
                            "fatal: 'main' is already checked out at '/root/pixel-tanks'",
                        );
                    }
                    return undefined; // прочее — дефолтное поведение рекордера
                },
            });
            expect(tryMergePhase(phase, deps)).toBe('merged');
            assertNoForbiddenGit(shCmds);
        });

        it('красный чек в реальном checksGreen → red-checks, дерево припарковано детачем на origin/main', () => {
            const { shCmds, deps } = mkWiring({
                shImpl: (cmd) => {
                    if (cmd === 'npm run test --silent') {
                        throw Object.assign(new Error('vitest упал'), {
                            stdout: '1 failed',
                            stderr: '',
                        });
                    }
                    return undefined;
                },
            });
            // getLastRedCheckFn по умолчанию null — подменим на реальный геттер, чтобы
            // tryMergePhase увидел красный чек, выставленный реальным checksGreen.
            deps.getLastRedCheckFn = getLastRedCheck;
            expect(tryMergePhase(phase, deps)).toBe('red-checks');
            expect(getLastRedCheck()).toMatchObject({ name: 'test' });
            // Парковка после красного — тоже строго детачем, инвариант держится.
            expect(shCmds).toContain('git checkout --detach origin/main');
            expect(shCmds).not.toContain("gh pr merge '5' --squash --delete-branch");
            assertNoForbiddenGit(shCmds);
        });
    });
});

// ── #130: роутинг ревью по зоне риска, запас после лимита, бюджет ходов ───────
// Мотивация из прогона 21.07.2026: ревью фазы 3 на fable выело окно лимита и
// остановило цикл на 21 минуту. Разбор показал две отдельные проблемы —
// эскалация решалась по метке СЛОЖНОСТИ issue (а должна — по цене ошибки), и
// ревью получало бюджет ходов кодера, хотя кода не пишет.

describe('globToRegExp — глобы зон риска (#130)', () => {
    const { globToRegExp } = ralph;

    it('** матчит вложенные сегменты', () => {
        const re = globToRegExp('.claude/ralph/**');
        expect(re.test('.claude/ralph/ralph.js')).toBe(true);
        expect(re.test('.claude/ralph/provision/provision.sh')).toBe(true);
    });

    it('** не выходит за пределы своего префикса', () => {
        const re = globToRegExp('.claude/ralph/**');
        expect(re.test('src/app/page.tsx')).toBe(false);
        expect(re.test('docs/.claude/ralph/x.js')).toBe(false);
    });

    it('одиночная * не перепрыгивает через /', () => {
        const re = globToRegExp('src/*.ts');
        expect(re.test('src/middleware.ts')).toBe(true);
        expect(re.test('src/payload/collections/users.ts')).toBe(false);
    });

    it('**/ матчит и корень, и вложенность', () => {
        const re = globToRegExp('**/middleware.ts');
        expect(re.test('middleware.ts')).toBe(true);
        expect(re.test('src/middleware.ts')).toBe(true);
        expect(re.test('src/middleware.test.ts')).toBe(false);
    });

    it('спецсимволы regexp в пути экранируются, а не исполняются', () => {
        // src/app/(payload) — реальный путь route-группы Next.js: скобки обязаны
        // читаться дословно, иначе это regexp-группа и матч поедет.
        const re = globToRegExp('src/app/(payload)/**');
        expect(re.test('src/app/(payload)/admin/page.tsx')).toBe(true);
        expect(re.test('src/app/payload/admin/page.tsx')).toBe(false);
        // Точка — тоже дословно, а не «любой символ».
        expect(globToRegExp('next.config.ts').test('nextXconfig.ts')).toBe(false);
    });
});

describe('matchRiskPaths — попадание диффа в зону риска (#130)', () => {
    const { matchRiskPaths } = ralph;
    const ZONES = ['.github/workflows/**', '.claude/ralph/**', 'src/payload/**'];

    it('возвращает первый файл из зоны риска', () => {
        const files = ['README.md', 'src/payload/collections/users.ts', 'src/app/page.tsx'];
        expect(matchRiskPaths(files, ZONES)).toBe('src/payload/collections/users.ts');
    });

    it('возвращает null, когда дифф целиком вне зон', () => {
        expect(matchRiskPaths(['src/app/page.tsx', 'README.md'], ZONES)).toBe(null);
    });

    it('пустой список зон никогда не эскалирует', () => {
        expect(matchRiskPaths(['.github/workflows/deploy.yml'], [])).toBe(null);
    });

    it('пустой дифф не эскалирует', () => {
        expect(matchRiskPaths([], ZONES)).toBe(null);
    });
});

describe('apiLimitWaitMs — сон до сброса окна лимита (#130)', () => {
    const { apiLimitWaitMs } = ralph;
    const MIN = 60 * 1000;

    beforeEach(() => {
        vi.useFakeTimers();
        // Полдень: «resets 1pm» → ровно час, без переползания через полночь.
        vi.setSystemTime(new Date(2026, 6, 21, 12, 0, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('к распарсенному времени сброса добавляет запас из конфига', () => {
        expect(apiLimitWaitMs('resets 1pm', { apiLimitGraceMin: 5 })).toBe(60 * MIN + 5 * MIN);
    });

    it('без ключа в конфиге запас — 5 минут (новый дефолт вместо 2)', () => {
        expect(apiLimitWaitMs('resets 1pm', {})).toBe(60 * MIN + 5 * MIN);
    });

    it('когда время сброса не распарсилось — fallback-ожидание плюс тот же запас', () => {
        expect(apiLimitWaitMs('лимит, но без времени', { apiLimitFallbackWaitMin: 30 })).toBe(
            30 * MIN + 5 * MIN,
        );
    });

    it('нулевой запас уважается и не подменяется дефолтом', () => {
        expect(apiLimitWaitMs('resets 1pm', { apiLimitGraceMin: 0 })).toBe(60 * MIN);
    });
});

describe('pickReviewModel — эскалация ревью (#130)', () => {
    const { pickReviewModel } = ralph;

    const CFG = {
        review: {
            default: 'claude-opus-4-8',
            escalated: 'claude-fable-5',
            escalateOn: [],
            escalateOnPaths: ['.github/workflows/**', '.claude/ralph/**'],
        },
    };
    const deps = (over = {}) => ({
        cfg: CFG,
        logFn: () => {},
        ghJsonFn: () => [],
        shFn: () => '',
        ...over,
    });

    it('дифф вне зон риска — ревьюит дефолтная модель', () => {
        const model = pickReviewModel(
            'Фаза X',
            'feature/x',
            deps({ shFn: () => 'src/app/page.tsx\nREADME.md' }),
        );
        expect(model).toBe('claude-opus-4-8');
    });

    it('дифф трогает деплой — эскалация на дорогую модель', () => {
        const model = pickReviewModel(
            'Фаза X',
            'feature/x',
            deps({ shFn: () => 'src/app/page.tsx\n.github/workflows/deploy.yml' }),
        );
        expect(model).toBe('claude-fable-5');
    });

    it('метка сложности сама по себе больше НЕ эскалирует', () => {
        // Ровно та регрессия, ради которой заведён #130: complexity:expert
        // описывает трудность написания, а не цену ошибки.
        const model = pickReviewModel(
            'Фаза X',
            'feature/x',
            deps({
                ghJsonFn: () => [{ labels: [{ name: 'complexity:expert' }] }],
                shFn: () => 'src/app/page.tsx',
            }),
        );
        expect(model).toBe('claude-opus-4-8');
    });

    it('escalateOn всё ещё работает, если его осознанно заполнили', () => {
        const cfg = { review: { ...CFG.review, escalateOn: ['complexity:expert'] } };
        const model = pickReviewModel(
            'Фаза X',
            'feature/x',
            deps({ cfg, ghJsonFn: () => [{ labels: [{ name: 'complexity:expert' }] }] }),
        );
        expect(model).toBe('claude-fable-5');
    });

    it('сбой git при получении диффа не роняет сдачу — ревью дефолтной моделью', () => {
        const logs = [];
        const model = pickReviewModel(
            'Фаза X',
            'feature/x',
            deps({
                logFn: (m) => logs.push(m),
                shFn: () => {
                    throw new Error('fatal: no upstream');
                },
            }),
        );
        expect(model).toBe('claude-opus-4-8');
        expect(logs.join('\n')).toMatch(/дифф/i);
    });

    it('имя ветки со спецсимволами шелла не уходит в git — эскалации нет, есть предупреждение', () => {
        // sh() исполняет СТРОКУ через шелл, поэтому ветка из конфига обязана быть
        // провалидирована до подстановки: `$(...)`/`;` внутри имени иначе исполнятся.
        const shCmds = [];
        const logs = [];
        const model = pickReviewModel(
            'Фаза X',
            'feature/x;$(id)',
            deps({
                logFn: (m) => logs.push(m),
                shFn: (cmd) => {
                    shCmds.push(cmd);
                    return '.github/workflows/deploy.yml';
                },
            }),
        );
        expect(shCmds).toEqual([]);
        expect(model).toBe('claude-opus-4-8');
        expect(logs.join('\n')).toMatch(/ветк/i);
    });

    it('легаси-конфиг без блока review — прежнее поле reviewModel', () => {
        expect(pickReviewModel('Фаза X', 'feature/x', deps({ cfg: { reviewModel: 'none' } }))).toBe(
            'none',
        );
    });
});

// ── #130: негативные входы и дефекты, найденные ревью PR #132 ────────────────
// Все пять сценариев ниже прошли сквозь ЗЕЛЁНЫЙ прогон первой версии — тесты
// проверяли только happy path. Каждый оказался реальным дефектом.

describe('apiLimitWaitMs — мусор в конфиге не превращается в вечный сон (#132)', () => {
    const { apiLimitWaitMs } = ralph;
    const MIN = 60 * 1000;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 6, 21, 12, 0, 0));
    });
    afterEach(() => vi.useRealTimers());

    // Atomics.wait(buf, 0, 0, NaN) спит БЕСКОНЕЧНО: NaN трактуется как +∞.
    // Раннер вставал бы навсегда, молча, с записью «Жду NaN мин» в логе.
    it.each([
        ['строка', 'abc'],
        ['null', null],
        ['объект', {}],
        ['отрицательное', -5],
    ])('apiLimitGraceMin = %s → дефолтные 5 минут, не NaN', (_name, value) => {
        const ms = apiLimitWaitMs('resets 1pm', { apiLimitGraceMin: value });
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBe(60 * MIN + 5 * MIN);
    });

    it('мусорный apiLimitFallbackWaitMin тоже не даёт NaN', () => {
        const ms = apiLimitWaitMs('лимит без времени', { apiLimitFallbackWaitMin: 'скоро' });
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBe(30 * MIN + 5 * MIN);
    });
});

// #138: сам предохранитель. Его смысл — не дать забытому моку тихо уйти в реальный
// шелл и в ralph.log живого прогона (так в лог фазы 4 попало
// `git fetch origin main 'feature/m1'` — ветка из фикстуры этого файла).
describe('предохранитель побочек в тестах: RALPH_NO_SIDE_EFFECTS (#138)', () => {
    const { sh, log, sideEffectAttempts } = ralph;

    it('переменная включена в окружении ralph-проекта vitest', () => {
        // Если предохранитель выключат в vitest.config.ts, тесты ниже станут
        // зелёными по ложной причине — фиксируем само условие.
        expect(process.env.RALPH_NO_SIDE_EFFECTS).toBe('1');
    });

    it('sh() отказывается исполнять команду, называет её в ошибке и пишет в журнал', () => {
        expect(() => sh('git fetch origin main')).toThrow(/RALPH_NO_SIDE_EFFECTS/);
        expect(() => sh('git fetch origin main')).toThrow(/git fetch origin main/);
        // Журнал — то, по чему общий afterEach ловит забытый мок даже когда вызов
        // обёрнут в try/catch. Здесь sh() вызван НАМЕРЕННО, поэтому журнал забираем
        // сами: иначе afterEach уронил бы этот же тест.
        expect(sideEffectAttempts.splice(0)).toEqual([
            'sh(git fetch origin main)',
            'sh(git fetch origin main)',
        ]);
    });

    it('проглоченный try/catch-ом вызов всё равно виден в журнале', () => {
        // Ровно исходный сценарий #138: phaseDiffFiles ловит ошибку git и возвращает
        // null, поэтому одного throw для покраснения теста не хватило бы.
        const files = ralph.phaseDiffFiles('feature/m1', { logFn: () => {} });
        expect(files).toBe(null);
        expect(sideEffectAttempts.splice(0)).toEqual([
            "sh(git fetch origin main 'feature/m1' --quiet)",
        ]);
    });

    it('дефолтный installFn (настоящий npm ci) тоже под предохранителем', () => {
        // Не только шелл: забытый installFn переустановил бы node_modules прямо во
        // время прогона тестов. Расширение предохранителя по ревью PR #141.
        expect(() =>
            ralph.syncDepsIfLockChanged({
                logFn: () => {},
                existsFn: () => true,
                readFn: (file) => (String(file).endsWith('.sha') ? 'старый-хэш' : 'lock'),
                writeFn: () => {},
            }),
        ).toThrow(/RALPH_NO_SIDE_EFFECTS/);
        expect(sideEffectAttempts.splice(0)).toEqual(['npm ci (syncDepsIfLockChanged)']);
    });

    it('дефолтный spawnFn (живая claude-сессия) тоже под предохранителем', () => {
        // Однажды тест уже пробился до настоящего spawnSync и запустил claude —
        // см. докблок spawnClaude. Теперь это громкая ошибка.
        expect(() => ralph.spawnClaude(['-p', 'привет'], 1000)).toThrow(/RALPH_NO_SIDE_EFFECTS/);
        expect(sideEffectAttempts.splice(0)).toEqual(['spawnClaude(claude)']);
    });

    it('log() пишет в консоль, но не трогает файл лога', () => {
        const append = vi.spyOn(fs, 'appendFileSync');
        const out = vi.spyOn(console, 'log').mockImplementation(() => {});
        log('строка, которой не место в ralph.log');
        expect(out).toHaveBeenCalled();
        expect(append).not.toHaveBeenCalled();
        out.mockRestore();
        append.mockRestore();
    });
});

describe('matchRiskPaths — кривой конфиг не роняет цикл сдачи (#132)', () => {
    const { matchRiskPaths } = ralph;

    // Забыть скобки вокруг единственного паттерна — типовая опечатка в JSON.
    // .map по строке = TypeError прямо в середине сдачи фазы, после ревью.
    it('escalateOnPaths строкой вместо массива — null, а не исключение', () => {
        expect(() => matchRiskPaths(['.github/workflows/deploy.yml'], '.github/**')).not.toThrow();
        expect(matchRiskPaths(['.github/workflows/deploy.yml'], '.github/**')).toBe(null);
    });

    it('files не массив — null, а не исключение', () => {
        expect(matchRiskPaths(null, ['.github/**'])).toBe(null);
        expect(matchRiskPaths(undefined, ['.github/**'])).toBe(null);
    });
});

describe('phaseDiffFiles — какая именно git-команда уходит в шелл (#132)', () => {
    const { phaseDiffFiles } = ralph;

    it('фетчит ДО диффа: решение не принимается по протухшим remote-ссылкам', () => {
        const cmds = [];
        phaseDiffFiles('feature/x', {
            shFn: (c) => {
                cmds.push(c);
                return '';
            },
            logFn: () => {},
        });
        expect(cmds[0]).toContain("git fetch origin main 'feature/x'");
        expect(cmds[1]).toContain('diff --name-only');
        expect(cmds[1]).toContain('origin/main...origin/feature/x');
    });

    it('дифф идёт с --no-renames: перенос файла ИЗ зоны риска виден', () => {
        // Без --no-renames git отдаёт только НОВЫЙ путь, и переезд
        // .github/workflows/deploy.yml → docs/old.yml прошёл бы мимо эскалации.
        const cmds = [];
        phaseDiffFiles('feature/x', {
            shFn: (c) => {
                cmds.push(c);
                return '';
            },
            logFn: () => {},
        });
        expect(cmds[1]).toContain('--no-renames');
    });

    it('падение fetch не роняет сдачу — null и предупреждение в лог', () => {
        const logs = [];
        const files = phaseDiffFiles('feature/x', {
            shFn: () => {
                throw new Error('fatal: could not read from remote');
            },
            logFn: (m) => logs.push(m),
        });
        expect(files).toBe(null);
        expect(logs.join('\n')).toMatch(/дифф/i);
    });
});

describe('pickReviewModel — отсутствующая escalated-модель не отменяет ревью (#132)', () => {
    const { pickReviewModel } = ralph;

    // undefined из эскалации runLoop трактует как «ревью за супервизором» и
    // пропускает ревью ЦЕЛИКОМ — fail-open ровно на самых опасных фазах.
    it('зона риска при незаданном review.escalated — ревью дефолтной моделью, не undefined', () => {
        const logs = [];
        const model = pickReviewModel('Фаза X', 'feature/x', {
            cfg: {
                review: {
                    default: 'claude-opus-4-8',
                    escalateOnPaths: ['.github/workflows/**'],
                },
            },
            logFn: (m) => logs.push(m),
            shFn: () => '.github/workflows/deploy.yml',
            ghJsonFn: () => [],
        });
        expect(model).toBe('claude-opus-4-8');
        expect(model).toBeDefined();
        expect(logs.join('\n')).toMatch(/escalated/i);
    });

    it('escalateOn строкой вместо массива не роняет выбор модели', () => {
        expect(() =>
            pickReviewModel('Фаза X', 'feature/x', {
                cfg: {
                    review: {
                        default: 'claude-opus-4-8',
                        escalated: 'claude-fable-5',
                        escalateOn: 'complexity:expert',
                    },
                },
                logFn: () => {},
                shFn: () => '',
                ghJsonFn: () => [],
            }),
        ).not.toThrow();
    });
});

describe('globToRegExp — ветки конвертера, не покрытые первой версией (#132)', () => {
    const { globToRegExp } = ralph;

    it('** в СЕРЕДИНЕ пути матчит любую вложенность между префиксом и хвостом', () => {
        const re = globToRegExp('src/**/collections/**');
        expect(re.test('src/payload/collections/users.ts')).toBe(true);
        expect(re.test('src/a/b/c/collections/x/y.ts')).toBe(true);
        expect(re.test('src/collections-lookalike/users.ts')).toBe(false);
    });

    it('? матчит ровно один символ и не перепрыгивает через /', () => {
        expect(globToRegExp('src/?.ts').test('src/a.ts')).toBe(true);
        expect(globToRegExp('src/?.ts').test('src/ab.ts')).toBe(false);
        expect(globToRegExp('src/?.ts').test('src//.ts')).toBe(false);
    });
});

describe('positiveIntOrDefault — бюджет ходов ревью (#132)', () => {
    const { positiveIntOrDefault } = ralph;

    it('нормальное значение проходит', () => {
        expect(positiveIntOrDefault(80, 200)).toBe(80);
    });

    // maxTurns: 0 — не «без ограничения», а сессия без единого хода.
    it.each([
        ['ноль', 0],
        ['отрицательное', -1],
        ['дробное', 12.5],
        ['строка', '80'],
        ['undefined', undefined],
        ['null', null],
    ])('%s → дефолт', (_name, value) => {
        expect(positiveIntOrDefault(value, 200)).toBe(200);
    });
});

describe('phaseDiffFiles — не-ASCII пути и пустой дифф (#132)', () => {
    const { phaseDiffFiles, matchRiskPaths } = ralph;

    it('core.quotePath=false — кириллический путь приходит как есть и матчится зоной', () => {
        const cmds = [];
        const files = phaseDiffFiles('feature/x', {
            shFn: (c) => {
                cmds.push(c);
                return c.includes('diff') ? 'src/payload/коллекции/пользователи.ts' : '';
            },
            logFn: () => {},
        });
        expect(cmds[1]).toContain('core.quotePath=false');
        // Без флага git отдал бы "src/payload/\320\272..." — мимо любого глоба.
        expect(matchRiskPaths(files, ['src/payload/**'])).toBe(
            'src/payload/коллекции/пользователи.ts',
        );
    });

    it('пустой дифф пишет предупреждение — это аномалия, а не «зоны не задеты»', () => {
        const logs = [];
        const files = phaseDiffFiles('feature/x', { shFn: () => '', logFn: (m) => logs.push(m) });
        expect(files).toEqual([]);
        expect(logs.join('\n')).toMatch(/пуст/i);
    });

    it('ветка не задана — отдельное сообщение, не «небезопасное имя»', () => {
        const logs = [];
        expect(phaseDiffFiles(undefined, { shFn: () => '', logFn: (m) => logs.push(m) })).toBe(
            null,
        );
        expect(logs.join('\n')).toMatch(/не задана/i);
        expect(logs.join('\n')).not.toMatch(/небезопасн/i);
    });
});

// ── #133: квотирование значений, уходящих в sh() ─────────────────────────────
// sh() исполняет строку через /bin/sh. milestone и branch приходят из конфига,
// номера и заголовки — из ответов gh (публичный GitHub). Раньше значения
// подставлялись голыми или в двойных кавычках, где $( ) раскрывается.

describe('shq — POSIX-квотирование для sh() (#133)', () => {
    const { shq } = ralph;
    const { execSync } = require('node:child_process');

    it('оборачивает обычное значение в одинарные кавычки', () => {
        expect(shq('feature/x')).toBe("'feature/x'");
    });

    it('одинарная кавычка внутри значения не разрывает квотирование', () => {
        expect(shq("don't")).toBe(`'don'\\''t'`);
    });

    // Главный сценарий: подстановка НЕ должна исполниться. Проверяем на живом
    // шелле, а не сверкой строк — иначе тест доказывает лишь мои представления
    // о квотировании, а не поведение /bin/sh.
    it.each([
        ['подстановка команды', '$(echo ВЗЛОМ)'],
        ['обратные кавычки', '`echo ВЗЛОМ`'],
        ['разделитель команд', '; echo ВЗЛОМ'],
        ['переменная', '$HOME'],
        ['кавычка и подстановка', `'; echo ВЗЛОМ; echo '`],
    ])('%s проходит через шелл дословно', (_name, payload) => {
        const out = execSync(`printf '%s' ${shq(payload)}`, { encoding: 'utf-8' });
        // Дословно = payload вернулся как есть. Если бы шелл его ИСПОЛНИЛ, на
        // выходе было бы 'ВЗЛОМ' (или подставленный $HOME) вместо самой строки.
        expect(out).toBe(payload);
        expect(out.trim()).not.toBe('ВЗЛОМ');
    });

    it('кириллица и типографика milestone переживают квотирование дословно', () => {
        const milestone = 'Прод-режим ralph · Фаза 4: Толстый гейт (prod)';
        const out = execSync(`printf '%s' ${shq(milestone)}`, { encoding: 'utf-8' });
        expect(out).toBe(milestone);
    });
});

describe('reviewDiffContext — дифф в промпт ревью (#133)', () => {
    const { reviewDiffContext } = ralph;

    const shOk = (diffBody) => (cmd) => {
        if (cmd.includes('fetch')) return '';
        if (cmd.includes('--name-only')) return 'src/a.ts\nsrc/b.ts';
        return diffBody;
    };

    it('подаёт список файлов и сам дифф', () => {
        const ctx = reviewDiffContext('feature/x', {
            shFn: shOk('diff --git a/src/a.ts b/src/a.ts\n+строка'),
            logFn: () => {},
        });
        expect(ctx).toContain('2 файлов');
        expect(ctx).toContain('- src/a.ts');
        expect(ctx).toContain('+строка');
    });

    // Молча обрезанный дифф — худший исход: ревью решит, что видело всё.
    it('обрезка помечается явно, с числами и указанием дочитать', () => {
        const huge = 'x'.repeat(5000);
        const ctx = reviewDiffContext('feature/x', {
            shFn: shOk(huge),
            logFn: () => {},
            limit: 1000,
        });
        expect(ctx).toContain('ДИФФ ОБРЕЗАН');
        expect(ctx).toContain('1000');
        expect(ctx).toContain('5000');
        expect(ctx).toContain('gh pr diff');
    });

    it('дифф в пределах лимита не помечается обрезанным', () => {
        const ctx = reviewDiffContext('feature/x', {
            shFn: shOk('короткий дифф'),
            logFn: () => {},
            limit: 1000,
        });
        expect(ctx).not.toContain('ОБРЕЗАН');
    });

    it('сбой текста диффа не роняет ревью — остаётся список файлов и совет', () => {
        const ctx = reviewDiffContext('feature/x', {
            shFn: (cmd) => {
                if (cmd.includes('--name-only')) return 'src/a.ts';
                if (cmd.includes('fetch')) return '';
                throw new Error('git diff умер');
            },
            logFn: () => {},
        });
        expect(ctx).toContain('- src/a.ts');
        expect(ctx).toContain('gh pr diff');
    });

    it('дифф недоступен целиком — пустая строка, промпт остаётся валидным', () => {
        const ctx = reviewDiffContext('feature/x', {
            shFn: () => {
                throw new Error('нет remote');
            },
            logFn: () => {},
        });
        expect(ctx).toBe('');
    });

    it('имя ветки уходит в git заквотированным', () => {
        const cmds = [];
        reviewDiffContext('feature/x', {
            shFn: (c) => {
                cmds.push(c);
                return c.includes('--name-only') ? 'src/a.ts' : 'дифф';
            },
            logFn: () => {},
        });
        expect(cmds.some((c) => c.includes(`'origin/main...origin/feature/x'`))).toBe(true);
    });
});

// ── #135: проводка контекста диффа до промпта ревью ─────────────────────────
// Ревью PR #135 вскрыло дыру в покрытии: сам reviewDiffContext был протестирован,
// а вот факт, что его результат ДОХОДИТ до промпта, — нет. Удаление ${diffContext}
// из шаблона оставляло все тесты зелёными.

describe('runLoop → промпт ревью получает контекст диффа (#135)', () => {
    const { runLoop } = ralph;

    const mkState = () => ({
        count: 0,
        milestone: 'M1',
        submitted: false,
        noProgress: 0,
        gateHeals: 0,
        blockedHeals: 0,
    });
    const cfg = () => ({
        model: 'claude-coder',
        prompt: 'сделай {milestone} в ветке {branch}',
        authorAllowlist: ['owner'],
        phases: [{ milestone: 'M1', branch: 'feature/m1' }],
        review: { default: 'claude-reviewer', maxTurns: 80 },
    });

    // Сдача фазы: issues кончились → PR → ревью → правки. Ловим все промпты.
    const runWithReview = (over = {}) => {
        const prompts = [];
        let idxCalls = 0;
        runLoop(
            cfg(),
            { state: mkState(), maxIterations: 10, maxTurns: 200 },
            {
                once: false,
                dry: false,
                logFn: () => {},
                shFn: () => '',
                saveStateFn: () => {},
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseIndexOfFn: () => (idxCalls++ === 0 ? 0 : 99),
                pickModelFn: () => 'claude-picked',
                pickReviewModelFn: () => 'claude-reviewer',
                runClaudeFn: (prompt) => {
                    prompts.push(prompt);
                    return 0;
                },
                ensureCleanFn: () => true,
                phaseMergedFn: () => false,
                advancePhaseFn: () => {},
                tryMergePhaseFn: () => 'not-merged',
                closeMilestoneByTitleFn: () => {},
                syncProjectBoardFn: () => {}, // #199: см. дефолт в общем deps выше
                getLastRedCheck: () => null,
                phaseDiffFilesFn: () => ['src/a.ts'],
                reviewDiffContextFn: () => '\n\nМАРКЕР-КОНТЕКСТА-ДИФФА',
                ...over,
            },
        );
        return prompts;
    };

    it('промпт ревью содержит контекст, отданный reviewDiffContext', () => {
        const reviewPrompt = runWithReview().find((p) => p.includes('code review'));
        expect(reviewPrompt).toBeDefined();
        expect(reviewPrompt).toContain('МАРКЕР-КОНТЕКСТА-ДИФФА');
    });

    it('дифф собирается ОДИН раз и переиспользуется выбором модели и контекстом', () => {
        let diffCalls = 0;
        const seen = {};
        runWithReview({
            phaseDiffFilesFn: () => {
                diffCalls++;
                return ['src/a.ts'];
            },
            pickReviewModelFn: (_m, _b, opts) => {
                seen.pick = opts?.files;
                return 'claude-reviewer';
            },
            reviewDiffContextFn: (_b, opts) => {
                seen.ctx = opts?.files;
                return '\n\nМАРКЕР-КОНТЕКСТА-ДИФФА';
            },
        });
        expect(diffCalls).toBe(1);
        expect(seen.pick).toEqual(['src/a.ts']);
        expect(seen.ctx).toEqual(['src/a.ts']);
    });

    it('пустой контекст не ломает промпт ревью', () => {
        const reviewPrompt = runWithReview({ reviewDiffContextFn: () => '' }).find((p) =>
            p.includes('code review'),
        );
        expect(reviewPrompt).toContain('Не мерджи PR');
    });
});

describe('safeBranch — argument injection через имя ветки (#135)', () => {
    const { safeBranch, phaseDiffFiles } = ralph;

    // Квотирование спасает от ИСПОЛНЕНИЯ, но не от argument injection:
    // '--upload-pack=…' остаётся отдельным словом, и git читает его как опцию.
    it.each([
        ['ведущий дефис', '-branch'],
        ['опция git', '--upload-pack=touch /tmp/pwned'],
        ['короткая опция', '-o'],
    ])('%s отвергается', (_name, branch) => {
        expect(safeBranch(branch, { logFn: () => {} })).toBe(false);
    });

    it.each([
        ['обычная ветка', 'feature/m1'],
        ['дефис внутри', 'chore/ralph-review-routing'],
        ['точки и подчёркивания', 'release/v1.2.3_rc'],
    ])('%s принимается', (_name, branch) => {
        expect(safeBranch(branch, { logFn: () => {} })).toBe(true);
    });

    it('ветка-опция не доходит до git', () => {
        const cmds = [];
        const files = phaseDiffFiles('--upload-pack=evil', {
            shFn: (c) => {
                cmds.push(c);
                return '';
            },
            logFn: () => {},
        });
        expect(files).toBe(null);
        expect(cmds).toEqual([]);
    });
});

describe('sliceWholeChars — обрезка не рубит суррогатную пару (#135)', () => {
    const { reviewDiffContext } = ralph;

    it('на границе лимита не остаётся половины эмодзи', () => {
        // 💥 = суррогатная пара: обрезка по символам ровно между ними даёт
        // невалидный код-юнит.
        const diff = 'a'.repeat(9) + '💥' + 'b'.repeat(100);
        const ctx = reviewDiffContext('feature/x', {
            shFn: (c) => (c.includes('--name-only') ? 'src/a.ts' : diff),
            logFn: () => {},
            limit: 10,
        });
        const body = ctx.split('=====')[2];
        expect(body).not.toMatch(/[\uD800-\uDBFF]$/);
        expect([...body].every((ch) => ch.codePointAt(0) !== 0xfffd)).toBe(true);
    });
});

// ── Автообновление worktree раннера перед стартом ────────────────────────────
// Существующий worktree подхватывался КАК ЕСТЬ — на коммите прошлого прогона.
// Симптом молчаливый: раннер здоров, но кодер-сессия внутри читает старые
// ralph.md/ralph.js, то есть работает по отменённым правилам.

describe('refreshRunnerWorktree — перевод дерева раннера на свежий origin/main', () => {
    const { refreshRunnerWorktree, ensureRunnerWorktree } = ralph;

    it('чистое дерево: fetch затем detach на origin/main', () => {
        const cmds = [];
        const ok = refreshRunnerWorktree('/tmp/wt', {
            shFn: (c) => {
                cmds.push(c);
                return '';
            },
            logFn: () => {},
        });
        expect(ok).toBe(true);
        expect(cmds[0]).toContain('status --porcelain');
        expect(cmds[1]).toContain('fetch origin main');
        expect(cmds[2]).toContain('checkout --detach origin/main');
    });

    // Незакоммиченная работа прошлой сессии дороже свежести: checkout её снесёт.
    it('грязное дерево не трогается, предупреждение в лог', () => {
        const cmds = [];
        const logs = [];
        const ok = refreshRunnerWorktree('/tmp/wt', {
            shFn: (c) => {
                cmds.push(c);
                return c.includes('status') ? ' M src/a.ts' : '';
            },
            logFn: (m) => logs.push(m),
        });
        expect(ok).toBe(false);
        expect(cmds.some((c) => c.includes('checkout'))).toBe(false);
        expect(logs.join('\n')).toMatch(/незакоммиченные/i);
    });

    it('сбой git не роняет запуск — false и запись в лог', () => {
        const logs = [];
        const ok = refreshRunnerWorktree('/tmp/wt', {
            shFn: (c) => {
                if (c.includes('fetch')) throw new Error('нет сети');
                return '';
            },
            logFn: (m) => logs.push(m),
        });
        expect(ok).toBe(false);
        expect(logs.join('\n')).toMatch(/обновить worktree/i);
    });

    it('путь worktree уходит в git заквотированным', () => {
        const cmds = [];
        refreshRunnerWorktree('/tmp/wt with space', {
            shFn: (c) => {
                cmds.push(c);
                return '';
            },
            logFn: () => {},
        });
        expect(cmds.every((c) => c.includes(`'/tmp/wt with space'`))).toBe(true);
    });

    it('ensureRunnerWorktree зовёт обновление при подхвате существующего дерева', () => {
        let refreshed = null;
        ensureRunnerWorktree('/tmp/wt', {
            shFn: () => 'worktree /tmp/wt\n',
            logFn: () => {},
            failFn: () => {},
            existsFn: () => true,
            refreshFn: (p) => {
                refreshed = p;
            },
            repoRoot: '/repo',
        });
        expect(refreshed).toBe('/tmp/wt');
    });
});

// #199: синк доски после мерджа фазы. Скрипт (scripts/project-sync.mjs) fail-closed и
// краснеет на сомнительных данных — это его тесты. Здесь проверяется ровно обёртка:
// она обязана быть best-effort, потому что косметика доски не имеет права ронять уже
// смердженную фазу.
describe('syncProjectBoard', () => {
    it('зовёт скрипт синка и логирует последнюю строку его вывода', () => {
        const cmds = [];
        const logs = [];
        ralph.syncProjectBoard(
            (c) => {
                cmds.push(c);
                return 'шум\n✅ project-sync: доска в порядке\n';
            },
            (m) => logs.push(m),
        );
        expect(cmds).toEqual(['node scripts/project-sync.mjs']);
        expect(logs[0]).toContain('доска в порядке');
    });

    it('не бросает, когда синк упал — фаза уже смерджена, ронять её нельзя', () => {
        const logs = [];
        expect(() =>
            ralph.syncProjectBoard(
                () => {
                    throw new Error('HTTP 401\nвторая строка');
                },
                (m) => logs.push(m),
            ),
        ).not.toThrow();
        expect(logs[0]).toContain('HTTP 401');
        expect(logs[0]).not.toContain('вторая строка');
    });
});
