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
    preflight,
    runLoop,
    loadState,
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

    it('фаза уже смерджена (идемпотентность, AFK): checkout+pull main, advancePhase, дальше', () => {
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
        expect(shCmds).toContain('git checkout main');
        expect(shCmds).toContain('git pull --ff-only');
        expect(advancePhaseFn).toHaveBeenCalledTimes(1);
        expect(logs.join('\n')).toMatch(/уже смерджена/);
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
