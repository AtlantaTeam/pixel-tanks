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
    buildClaudeArgs,
    formatExcerpt,
    parseResetWaitMs,
    API_LIMIT_RE,
    spawnClaude,
    tunnelHealthy,
    ensureTunnel,
    tunnelCheckEnabled,
    probeEgress,
    restartTunnel,
    resolveWorktreePath,
    parseWorktreeList,
    ensureRunnerWorktree,
    preflight,
    runLoop,
    loadState,
    checkoutMainQuiet,
    checksGreen,
    tryMergePhase,
    getLastRedCheck,
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

    it('cfg.runnerWorktreePath важнее env (явный конфиг не должен молча перебиваться)', () => {
        process.env.RALPH_WORKTREE_PATH = '/tmp/from-env';
        expect(
            resolveWorktreePath({ runnerWorktreePath: '/tmp/from-config' }, '/root/pixel-tanks'),
        ).toBe('/tmp/from-config');
    });
});

describe('ensureRunnerWorktree — выделенный git worktree раннера, соседний с деревом человека (#76)', () => {
    it('уже зарегистрирован (git worktree list его содержит) → переиспользуем, без add/npm ci', () => {
        const shFn = vi
            .fn()
            .mockReturnValue(
                'worktree /root/pixel-tanks\nHEAD abc123\nbranch refs/heads/main\n\n' +
                    'worktree /root/pixel-tanks-ralph\nHEAD def456\ndetached\n',
            );
        const logFn = vi.fn();
        const installFn = vi.fn();
        const result = ensureRunnerWorktree('/root/pixel-tanks-ralph', { shFn, logFn, installFn });
        expect(result).toBe('/root/pixel-tanks-ralph');
        expect(shFn).toHaveBeenCalledTimes(1); // только list, без add
        expect(installFn).not.toHaveBeenCalled();
    });

    it('не зарегистрирован и путь свободен → git worktree add --detach + npm ci', () => {
        const shFn = vi
            .fn()
            .mockReturnValueOnce(
                'worktree /root/pixel-tanks\nHEAD abc123\nbranch refs/heads/main\n',
            )
            .mockReturnValueOnce('');
        const existsFn = vi.fn().mockReturnValue(false);
        const installFn = vi.fn();
        const logFn = vi.fn();
        const result = ensureRunnerWorktree('/root/pixel-tanks-ralph', {
            shFn,
            existsFn,
            installFn,
            logFn,
        });
        expect(result).toBe('/root/pixel-tanks-ralph');
        expect(shFn).toHaveBeenCalledWith('git worktree add /root/pixel-tanks-ralph --detach');
        expect(installFn).toHaveBeenCalledWith('/root/pixel-tanks-ralph');
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
            ensureRunnerWorktree('/root/pixel-tanks-ralph', { shFn, existsFn, failFn, installFn }),
        ).toThrow('stopped');
        expect(failFn).toHaveBeenCalledTimes(1);
        expect(failFn.mock.calls[0][0]).toMatch(/не зарегистрирован как git worktree/);
        expect(installFn).not.toHaveBeenCalled();
    });

    it('git worktree list упал (не git-репо/gh недоступен) → fail-closed, add не вызывается', () => {
        const shFn = vi.fn().mockImplementation(() => {
            throw new Error('not a git repository');
        });
        const failFn = vi.fn(() => {
            throw new Error('stopped');
        });
        expect(() => ensureRunnerWorktree('/root/pixel-tanks-ralph', { shFn, failFn })).toThrow(
            'stopped',
        );
        expect(failFn.mock.calls[0][0]).toMatch(/git worktree list/);
    });

    it('git worktree add упал → fail-closed, npm ci не запускается', () => {
        const shFn = vi
            .fn()
            .mockReturnValueOnce(
                'worktree /root/pixel-tanks\nHEAD abc123\nbranch refs/heads/main\n',
            )
            .mockImplementationOnce(() => {
                throw new Error('branch already checked out');
            });
        const existsFn = vi.fn().mockReturnValue(false);
        const failFn = vi.fn(() => {
            throw new Error('stopped');
        });
        const installFn = vi.fn();
        const logFn = vi.fn();
        expect(() =>
            ensureRunnerWorktree('/root/pixel-tanks-ralph', {
                shFn,
                existsFn,
                failFn,
                installFn,
                logFn,
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
            .mockReturnValueOnce('');
        const existsFn = vi.fn().mockReturnValue(false);
        const installFn = vi.fn(() => {
            throw new Error('npm ci failed');
        });
        const failFn = vi.fn(() => {
            throw new Error('stopped');
        });
        const logFn = vi.fn();
        expect(() =>
            ensureRunnerWorktree('/root/pixel-tanks-ralph', {
                shFn,
                existsFn,
                installFn,
                failFn,
                logFn,
            }),
        ).toThrow('stopped');
        expect(failFn.mock.calls[0][0]).toMatch(/npm ci/);
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
            runClaudeFn: () => 0,
            ensureCleanFn: () => true,
            phaseMergedFn: () => false,
            advancePhaseFn: () => {},
            tryMergePhaseFn: () => 'not-merged',
            closeMilestoneByTitleFn: () => {},
            getLastRedCheck: () => null,
            ...o,
        };
    };
    const ctx = (state, o = {}) => ({ state, maxIterations: 10, maxTurns: 200, ...o });

    it('фаза не резолвится (все пройдены) → лог «все фазы завершены» и выход', () => {
        const logs = [];
        runLoop(validCfg(), ctx(mkState()), deps(logs, { phaseIndexOfFn: () => 99 }));
        expect(logs.join('\n')).toMatch(/Все фазы завершены/);
    });

    it('breaker maxIterations (AFK): count>=лимит → сброс count, saveState, стоп', () => {
        const logs = [];
        const state = mkState({ count: 10 });
        const saveStateFn = vi.fn();
        const runClaudeFn = vi.fn(() => 0);
        runLoop(
            validCfg(),
            ctx(state, { maxIterations: 10 }),
            deps(logs, { phaseIndexOfFn: () => 0, saveStateFn, runClaudeFn }),
        );
        expect(logs.join('\n')).toMatch(/Circuit breaker: лимит итераций/);
        expect(state.count).toBe(0);
        expect(saveStateFn).toHaveBeenCalled();
        expect(runClaudeFn).not.toHaveBeenCalled(); // до итерации не дошли
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

    it('no-progress breaker (AFK): HEAD не сдвинулся и очередь та же → стоп', () => {
        const logs = [];
        const state = mkState({ noProgress: 2 }); // +1 на этой итерации = 3 = порог
        runLoop(
            validCfg(),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [{ number: 7, title: 't', labels: [] }],
                shFn: () => 'SAME_HEAD', // headBefore === headAfter → нет коммитов
                runClaudeFn: () => 0,
            }),
        );
        expect(logs.join('\n')).toMatch(/Circuit breaker.*без прогресса/s);
        expect(state.noProgress).toBe(0); // сброшен перед стопом
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

    it('полная сдача → гейт merged → закрыть milestone + advancePhase', () => {
        const logs = [];
        const closeMilestoneByTitleFn = vi.fn();
        const advancePhaseFn = vi.fn();
        const tryMergePhaseFn = vi.fn(() => 'merged');
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
            }),
        );
        expect(tryMergePhaseFn).toHaveBeenCalledTimes(1);
        expect(closeMilestoneByTitleFn).toHaveBeenCalledWith('M1');
        expect(advancePhaseFn).toHaveBeenCalledTimes(1);
        expect(logs.join('\n')).toMatch(/Ревью PR — за супервизором/);
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

    it('гейт blocked, бюджет исчерпан → стоп без чини-сессии, сброс счётчика', () => {
        const logs = [];
        const state = mkState({ submitted: true, blockedHeals: 3 });
        const runClaudeFn = vi.fn(() => 0);
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
            }),
        );
        expect(runClaudeFn).not.toHaveBeenCalled();
        expect(state.blockedHeals).toBe(0);
        expect(logs.join('\n')).toMatch(/blocked устоял/);
    });

    // Ключевое поведенческое обещание профиля prod (#73): не «в конфиге стоит 0», а
    // «чини-сессия не запускается вовсе». Регресс `?? 3` → `|| 3` ловится только так.
    it('профиль prod (blockedHealAttempts=0) → блокер сразу человеку, чини-сессия НЕ зовётся', () => {
        const logs = [];
        const state = mkState({ submitted: true, blockedHeals: 0 });
        const runClaudeFn = vi.fn(() => 0);
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
            }),
        );
        expect(runClaudeFn).not.toHaveBeenCalled();
        // Сообщение говорит «выключено профилем», а не «устоял после 0 разборов».
        expect(logs.join('\n')).toMatch(/выключен профилем "prod"/);
        expect(logs.join('\n')).not.toMatch(/устоял после 0/);
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

describe('ветковая хореография в worktree раннера (#77)', () => {
    // Модель после #76: раннер живёт в выделенном worktree, а git не даёт занять один
    // ref двум worktree сразу. Поэтому гейт НЕ занимает именованных веток вовсе:
    // чеки — на detached PR-head sha, парковка/обновление — detached origin/main.
    // Локальный main (ref человека) раннер не трогает никогда.
    const SHA_A = 'a'.repeat(40);
    const SHA_B = 'b'.repeat(40);

    describe('checkoutMainQuiet — парковка дерева раннера', () => {
        it('паркует detached на origin/main, НЕ занимая ветку main', () => {
            const shCmds = [];
            checkoutMainQuiet({ shFn: (c) => shCmds.push(c), logFn: () => {} });
            expect(shCmds).toEqual(['git checkout --detach origin/main']);
        });

        it('best-effort: сбой checkout не бросает, только лог', () => {
            const logs = [];
            expect(() =>
                checkoutMainQuiet({
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
                ...rest,
            };
            return { shCmds, parkFn, deps };
        };

        it('зелёный путь: fetch → сверка → detach на sha PR → все чеки → true', () => {
            const { shCmds, parkFn, deps } = mkDeps();
            expect(checksGreen('feature/m1', 42, deps)).toBe(true);
            expect(shCmds).toContain('git fetch origin feature/m1');
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
                ...rest,
            };
            return { shCmds, parkFn, deps };
        };

        it('зелёный гейт: squash-merge, затем fetch + detach origin/main → merged', () => {
            const { shCmds, deps } = mkDeps();
            expect(tryMergePhase(phase, deps)).toBe('merged');
            const mergeIdx = shCmds.findIndex(
                (c) => c === 'gh pr merge 5 --squash --delete-branch',
            );
            expect(mergeIdx).toBeGreaterThanOrEqual(0);
            // Обновление раннера — строго через origin/main и ПОСЛЕ мерджа.
            expect(shCmds.indexOf('git fetch origin main')).toBeGreaterThan(mergeIdx);
            expect(shCmds).toContain('git checkout --detach origin/main');
            expect(shCmds).not.toContain('git checkout main');
            expect(shCmds).not.toContain('git pull --ff-only');
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

    it('prod: blocked-разбор выключен — блокер ревью уходит человеку, не чинится сам', () => {
        expect(resolveProfile(raw, 'prod', boom).blockedHealAttempts).toBe(0);
    });

    it('prod наследует всё остальное из common, не дублируя его', () => {
        const pg = resolveProfile(raw, 'playground', boom);
        const prod = resolveProfile(raw, 'prod', boom);
        expect(prod.modelRouting).toEqual(pg.modelRouting);
        expect(prod.review).toEqual(pg.review);
        expect(prod.phases).toEqual(pg.phases);
        expect(prod.authorAllowlist).toEqual(pg.authorAllowlist);
        // Дельта prod в файле — ровно то, что заявлено, без случайных дублей.
        expect(Object.keys(raw.profiles.prod)).toEqual(['blockedHealAttempts']);
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
