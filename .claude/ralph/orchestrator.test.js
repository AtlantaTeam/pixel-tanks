// Тесты оркестратора петли (orchestrator.ts) через боевую поверхность ralph.js — так их
// видит вызывающий: entry собирает фабрику createOrchestrator и ре-экспортирует функции,
// поэтому здесь проверяется и поведение петли целиком (сессия claude, preflight, runLoop,
// ветковая хореография, монитор, ревью-контекст, milestones/доска), и контракт самой
// фабрики/«тонкость» entry (створки блоки в конце файла).
//
// Файл — единственный тест-файл модуля orchestrator.ts (#366, один файл на модуль):
// намеренно .js, а не .ts — дословный перенос блоков из монолитного ralph.test.js (тоже
// .js) под tsc --strict потребовал бы переписывания моков под явные типы на ~4600 строк,
// то есть менял бы суть сценариев, а не их расположение. .claude/ralph/tsconfig.json
// включает только **/*.ts, поэтому файл вне периметра typecheck:ralph — как и остальные
// тесты .js-модулей (monitor.test.js, deadman.test.js, telegram-notifier.test.js,
// gate-env.test.js); orchestrator.ts сам по себе остаётся типизированным и проверяемым.
//
// Файл собран при разнесении монолитного ralph.test.js по модульным тест-файлам (#366):
// блоки перенесены как есть, включая их фикстуры и комментарии.
//
// Тесты детерминированы: время мокается фейк-таймерами, платформо- и TZ-независимы.
// Побочек нет ни одной: все коллабораторы (sh/shArgv/spawn/gh/fs) инжектируются, а
// боевые дефолты под RALPH_NO_SIDE_EFFECTS=1 громко падают на guardSideEffect (#138) —
// общий afterEach из test-setup.js сверяет журнал попыток.
//
// spawnClaude тестируем через явную инъекцию фейковой spawn-функции (3-й параметр),
// НЕ через vi.mock('node:child_process'): мок модуля на границе CJS require()
// (которым ralph.js подключает child_process) ненадёжен — при первой попытке тест
// пробился до настоящего spawnSync и запустил живой процесс `claude` вместо фейка.
// Явный параметр детерминирован независимо от того, как раннер загружен.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import ralph from './ralph.js';

// #204: состав чеков гейта переехал в ralph.config.json. gateChecksFor и tryMergePhase
// читают ФАБРИЧНЫЙ config, который в проде ставит main() (в юнит-тестах не запускаемая).
// Засеваем его боевым конфигом один раз — так gateChecksFor('prod') и внутренний вызов
// в tryMergePhase получают реальный состав чеков, а ассерты сторожат ШИПНУТЫЙ конфиг
// (что fail-fast порядок и дедуп не съехали в файле).
const REAL_CONFIG = ralph.resolveProfile(
    JSON.parse(fs.readFileSync('.claude/ralph/ralph.config.json', 'utf-8')),
    'playground',
);
ralph.setConfigForTests(REAL_CONFIG);

const {
    startMonitor,
    stopMonitor,
    adoptMonitor,
    processAlive,
    cmdlineIncludes,
    isMonitorProcess,
    isRalphMonitorProcess,
    acquireRunnerLock,
    listMonitorPids,
    processPpid,
    sweepOrphanMonitors,
    ensureMonitorAlive,
    buildClaudeArgs,
    formatExcerpt,
    spawnClaude,
    ensureTunnel,
    pushEvent,
    syncDepsIfLockChanged,
    preflight,
    runLoop,
    loadState,
    ensureClean,
    parkOnOriginMain,
    gateChecksFor,
    checksGreen,
    tryMergePhase,
    waitForDeployRun,
    mergedShaOf,
    checkProdHealth,
    getLastRedCheck,
    getVerifiedHead,
    getLastGatePr,
} = ralph;

// #252: git-хелперы гейта разделены на shFn (чтения) и runArgvFn (argv-мутации). Этот
// рекордер пишет ОБА канала в один общий `cmds`, нормализуя runArgvFn в `${file} ${args}`,
// чтобы ассерты на ПОРЯДОК команд остались осмысленными. Общий на phaseDiffFiles и
// refreshRunnerWorktree — иначе правка формата записи требовала бы синхронных правок в двух.
const mkCmdRecorders = (shImpl) => {
    const cmds = [];
    return {
        cmds,
        shFn: (c) => {
            cmds.push(c);
            return shImpl ? shImpl(c) : '';
        },
        runArgvFn: (file, args) => {
            const cmd = `${file} ${args.join(' ')}`;
            cmds.push(cmd);
            return shImpl ? shImpl(cmd) : '';
        },
    };
};

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

    it('fallbackModel из конфига используется, когда опция fallbackModel не передана (back-compat)', () => {
        const argv = buildClaudeArgs('x', { maxTurns: 200 }, { fallbackModel: 'claude-sonnet-5' });
        expect(argv[argv.indexOf('--fallback-model') + 1]).toBe('claude-sonnet-5');
    });

    // #221: review.fallback передаётся как явный override и не зависит от общего
    // cfg.fallbackModel — раньше это было ролью noFallback:true (M8), теперь ревью
    // явно указывает СВОЮ модель фолбэка (см. pickReviewFallbackModel).
    it('явный опции.fallbackModel переопределяет cfg.fallbackModel', () => {
        const argv = buildClaudeArgs(
            'x',
            { maxTurns: 200, fallbackModel: 'claude-opus-4-8' },
            { fallbackModel: 'claude-sonnet-5' },
        );
        expect(argv[argv.indexOf('--fallback-model') + 1]).toBe('claude-opus-4-8');
    });

    it('опции.fallbackModel = null подавляет --fallback-model, даже если в конфиге он задан (fail-closed без фолбэка)', () => {
        const argv = buildClaudeArgs(
            'x',
            { maxTurns: 200, fallbackModel: null },
            { fallbackModel: 'claude-sonnet-5' },
        );
        expect(argv).not.toContain('--fallback-model');
    });

    it('опции.fallbackModel = "none" тоже подавляет --fallback-model', () => {
        const argv = buildClaudeArgs(
            'x',
            { maxTurns: 200, fallbackModel: 'none' },
            { fallbackModel: 'claude-sonnet-5' },
        );
        expect(argv).not.toContain('--fallback-model');
    });

    it('без fallbackModel в конфиге и в опциях флаг fallback не появляется', () => {
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

    it('без env-аргумента опции spawn НЕ содержат ключ env — Claude-путь наследует env раннера байт-в-байт', () => {
        spawnFn.mockReturnValue({ status: 0, stdout: 'ok', stderr: '', signal: null });
        spawnClaude(['-p', 'x', '--max-turns', '1'], 1000, spawnFn);
        const [, , opts] = spawnFn.mock.calls[0];
        expect('env' in opts).toBe(false);
    });

    it('с env-аргументом (#373 Kimi) опции spawn несут ровно этот env', () => {
        spawnFn.mockReturnValue({ status: 0, stdout: 'ok', stderr: '', signal: null });
        const env = { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic' };
        spawnClaude(['-p', 'x', '--max-turns', '1'], 1000, spawnFn, env);
        const [, , opts] = spawnFn.mock.calls[0];
        expect(opts.env).toBe(env);
        expect(opts.shell).toBe(false);
    });
});

// #373 (фаза 6): рантайм Kimi — тот же бинарь `claude` через endpoint Moonshot, выбор
// конфигом (adapters.coderRuntime: 'kimi'). Смоук + юниты чистых хелперов. Claude-путь не
// меняется: дефолт coderRuntime остаётся claude, его сценарии выше зелёные.
describe('Kimi-рантайм (#373) — Claude-spawn + env Moonshot', () => {
    // Боевой fail уходит в process.exit; в тестах инжектируем бросающий, чтобы увидеть стоп.
    const throwingFail = (msg) => {
        throw new Error(msg);
    };

    describe('buildKimiSpawnEnv — окружение процесса claude под Moonshot (чистая функция)', () => {
        const { buildKimiSpawnEnv } = ralph;

        it('добавляет ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN, наследуя базовое env', () => {
            const env = buildKimiSpawnEnv('https://api.moonshot.ai/anthropic', 'sk-moon', {
                PATH: '/usr/bin',
                HOME: '/root',
            });
            expect(env.ANTHROPIC_BASE_URL).toBe('https://api.moonshot.ai/anthropic');
            expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-moon');
            expect(env.PATH).toBe('/usr/bin');
            expect(env.HOME).toBe('/root');
        });

        it('снимает каналы Claude-аутентификации (иначе CLI ушёл бы на api.anthropic.com мимо Kimi)', () => {
            const env = buildKimiSpawnEnv('https://api.moonshot.ai/anthropic', 'sk-moon', {
                CLAUDE_CODE_OAUTH_TOKEN: 'oauth-claude',
                ANTHROPIC_API_KEY: 'anthropic-key',
            });
            expect('CLAUDE_CODE_OAUTH_TOKEN' in env).toBe(false);
            expect('ANTHROPIC_API_KEY' in env).toBe(false);
        });

        it('не мутирует переданное базовое env', () => {
            const base = { CLAUDE_CODE_OAUTH_TOKEN: 'x', PATH: '/usr/bin' };
            buildKimiSpawnEnv('u', 't', base);
            expect(base.CLAUDE_CODE_OAUTH_TOKEN).toBe('x');
        });
    });

    describe('resolveKimiRuntime — резолв параметров из конфига + env (fail-closed)', () => {
        const { resolveKimiRuntime } = ralph;

        it('дефолты: международный endpoint и env RALPH_KIMI_AUTH_TOKEN', () => {
            const r = resolveKimiRuntime(
                { model: 'kimi-k2-0711-preview' },
                { RALPH_KIMI_AUTH_TOKEN: 'sk-moon' },
                throwingFail,
            );
            expect(r.baseUrl).toBe('https://api.moonshot.ai/anthropic');
            expect(r.model).toBe('kimi-k2-0711-preview');
            expect(r.token).toBe('sk-moon');
            expect(r.fallbackModel).toBe(null);
        });

        it('переопределение baseUrl/authTokenEnv/fallbackModel из конфига', () => {
            const r = resolveKimiRuntime(
                {
                    model: 'kimi-k2-0711-preview',
                    baseUrl: 'https://api.moonshot.cn/anthropic',
                    authTokenEnv: 'MY_KIMI_KEY',
                    fallbackModel: 'kimi-k2-turbo',
                },
                { MY_KIMI_KEY: 'sk-cn' },
                throwingFail,
            );
            expect(r.baseUrl).toBe('https://api.moonshot.cn/anthropic');
            expect(r.token).toBe('sk-cn');
            expect(r.fallbackModel).toBe('kimi-k2-turbo');
        });

        it('отсутствующая/пустая модель → fail (тихий сбой на endpoint Kimi недопустим)', () => {
            expect(() =>
                resolveKimiRuntime({}, { RALPH_KIMI_AUTH_TOKEN: 'x' }, throwingFail),
            ).toThrow(/kimiRuntime\.model/);
            expect(() =>
                resolveKimiRuntime({ model: '   ' }, { RALPH_KIMI_AUTH_TOKEN: 'x' }, throwingFail),
            ).toThrow(/kimiRuntime\.model/);
        });

        it('отсутствующий ключ Moonshot в env → fail (секреты только из env, инвариант №11)', () => {
            expect(() =>
                resolveKimiRuntime({ model: 'kimi-k2-0711-preview' }, {}, throwingFail),
            ).toThrow(/RALPH_KIMI_AUTH_TOKEN/);
        });

        it('requireToken:false (dry) — без ключа не падает, token=null, но кривая модель всё равно fail', () => {
            const r = resolveKimiRuntime({ model: 'kimi-k2-0711-preview' }, {}, throwingFail, {
                requireToken: false,
            });
            expect(r.token).toBe(null);
            expect(() => resolveKimiRuntime({}, {}, throwingFail, { requireToken: false })).toThrow(
                /kimiRuntime\.model/,
            );
        });
    });

    describe('runKimiOnce — смоук: кодер-сессия стартует и выдаёт дифф', () => {
        let runtime;
        const savedToken = process.env.RALPH_KIMI_AUTH_TOKEN;

        beforeEach(() => {
            vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
            vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
            vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
            runtime = buildRuntime();
            runtime.setConfigForTests({
                ...REAL_CONFIG,
                permissionMode: 'bypassPermissions',
                kimiRuntime: { model: 'kimi-k2-0711-preview' },
            });
            process.env.RALPH_KIMI_AUTH_TOKEN = 'sk-moon-smoke';
        });
        afterEach(() => {
            vi.restoreAllMocks();
            if (savedToken === undefined) delete process.env.RALPH_KIMI_AUTH_TOKEN;
            else process.env.RALPH_KIMI_AUTH_TOKEN = savedToken;
        });

        it('спавнит `claude` с моделью Kimi и env Moonshot, возвращает дифф, токен НЕ в argv', () => {
            const spawnFn = vi.fn(() => ({
                status: 0,
                stdout: 'diff --git a/f b/f\n+добавлено',
                stderr: '',
                signal: null,
            }));

            const res = runtime.runKimiOnce('тестовая задача', { maxTurns: 5 }, spawnFn);

            expect(res).toEqual({ code: 0, output: 'diff --git a/f b/f\n+добавлено\n' });
            expect(spawnFn).toHaveBeenCalledTimes(1);
            const [bin, argv, opts] = spawnFn.mock.calls[0];
            expect(bin).toBe('claude');
            // Модель — Moonshot из kimiRuntime.model, а НЕ claude-модель из modelRouting.
            expect(argv).toContain('--model');
            expect(argv[argv.indexOf('--model') + 1]).toBe('kimi-k2-0711-preview');
            expect(argv).toContain('--permission-mode');
            // Секрет ушёл env'ом, не в argv (иначе виден в /proc/*/cmdline).
            expect(argv.join(' ')).not.toContain('sk-moon-smoke');
            expect(opts.shell).toBe(false);
            expect(opts.env.ANTHROPIC_BASE_URL).toBe('https://api.moonshot.ai/anthropic');
            expect(opts.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-moon-smoke');
        });

        it('НЕ подмешивает общий claude fallbackModel в Kimi-сессию (research, риск #3)', () => {
            const spawnFn = vi.fn(() => ({ status: 0, stdout: 'ok', stderr: '', signal: null }));
            // REAL_CONFIG.fallbackModel = claude-opus-4-8 — он не должен утечь в argv Kimi.
            runtime.runKimiOnce('x', { maxTurns: 1 }, spawnFn);
            const [, argv] = spawnFn.mock.calls[0];
            expect(argv).not.toContain('--fallback-model');
        });

        it('выбор coderRuntime:kimi в конфиге даёт Kimi-адаптер из реестра', () => {
            const kimiRuntime = buildRuntime();
            const adapters = kimiRuntime.buildAdapters(
                {
                    taskSource: { github: { x: 1 } },
                    gate: { npm: { x: 1 } },
                    notifier: { telegram: { x: 1 } },
                    deployCheck: { 'github-actions': { x: 1 } },
                    coderRuntime: {
                        claude: { run: () => ({ code: 0, output: 'claude' }) },
                        kimi: { run: () => ({ code: 0, output: 'kimi' }) },
                    },
                },
                kimiRuntime.resolveAdapterSelection({ coderRuntime: 'kimi' }, throwingFail),
                throwingFail,
            );
            expect(adapters.coderRuntime.run('p', { maxTurns: 1 }).output).toBe('kimi');
        });
    });
});

// #374 (фаза 6): рантайм OpenAI — ОТДЕЛЬНЫЙ бинарь `codex exec` (не поверх claude), выбор
// конфигом (adapters.coderRuntime: 'openai'). Смоук + юниты чистых хелперов. Claude-путь не
// меняется: дефолт coderRuntime остаётся claude, его сценарии выше зелёные.
describe('OpenAI-рантайм (#374) — codex exec, отдельный бинарь', () => {
    // Боевой fail уходит в process.exit; в тестах инжектируем бросающий, чтобы увидеть стоп.
    const throwingFail = (msg) => {
        throw new Error(msg);
    };

    describe('buildCodexArgs — построение argv для `codex exec` (чистая функция)', () => {
        const { buildCodexArgs } = ralph;

        it('exec + аппрув never + песочница + модель + `--` перед промптом', () => {
            const argv = buildCodexArgs('задача', {
                model: 'gpt-5-codex',
                sandboxMode: 'danger-full-access',
            });
            expect(argv).toEqual([
                'exec',
                '-a',
                'never',
                '-s',
                'danger-full-access',
                '-m',
                'gpt-5-codex',
                '--',
                'задача',
            ]);
        });

        it('промпт — последний позиционный элемент, ПОСЛЕ `--` (не истолкуется как флаг)', () => {
            // Промпт, начинающийся с дефиса, — ровно тот класс, ради которого стоит `--`:
            // без разделителя codex принял бы его за неизвестный флаг и упал.
            const argv = buildCodexArgs('-rf уничтожить', {
                model: 'gpt-5-codex',
                sandboxMode: 'workspace-write',
            });
            const sep = argv.indexOf('--');
            expect(sep).toBeGreaterThan(-1);
            expect(argv[sep + 1]).toBe('-rf уничтожить');
            expect(argv[argv.length - 1]).toBe('-rf уничтожить');
        });

        it('без модели пара -m не добавляется (резолв всё равно её требует — fail-closed выше)', () => {
            const argv = buildCodexArgs('x', { sandboxMode: 'read-only' });
            expect(argv).not.toContain('-m');
        });

        it('НЕ содержит Claude-специфичных флагов --max-turns/--fallback-model (риск #3)', () => {
            const argv = buildCodexArgs('x', {
                model: 'gpt-5-codex',
                sandboxMode: 'danger-full-access',
            });
            expect(argv).not.toContain('--max-turns');
            expect(argv).not.toContain('--fallback-model');
        });

        it('anti-RCE: спецсимволы промпта проходят ОДНИМ дословным элементом argv', () => {
            const evil = 'вывод: `rm -rf /` и $(whoami) и "кавычки" ; echo pwned';
            const argv = buildCodexArgs(evil, {
                model: 'gpt-5-codex',
                sandboxMode: 'danger-full-access',
            });
            expect(argv[argv.length - 1]).toBe(evil);
        });
    });

    describe('buildOpenAISpawnEnv — окружение процесса codex (чистая функция)', () => {
        const { buildOpenAISpawnEnv } = ralph;

        it('кладёт ключ под OPENAI_API_KEY, наследуя базовое env', () => {
            const env = buildOpenAISpawnEnv('sk-openai', { PATH: '/usr/bin', HOME: '/root' });
            expect(env.OPENAI_API_KEY).toBe('sk-openai');
            expect(env.PATH).toBe('/usr/bin');
            expect(env.HOME).toBe('/root');
        });

        it('ключ codex ждёт именно в OPENAI_API_KEY, даже если резолвился из другой env-переменной', () => {
            // authTokenEnv может быть кастомным (MY_OPENAI_KEY), но codex читает OPENAI_API_KEY —
            // маппинг делает именно этот хелпер.
            const env = buildOpenAISpawnEnv('sk-from-custom', { MY_OPENAI_KEY: 'sk-from-custom' });
            expect(env.OPENAI_API_KEY).toBe('sk-from-custom');
        });

        it('не мутирует переданное базовое env', () => {
            const base = { PATH: '/usr/bin' };
            buildOpenAISpawnEnv('t', base);
            expect('OPENAI_API_KEY' in base).toBe(false);
        });
    });

    describe('resolveOpenAIRuntime — резолв параметров из конфига + env (fail-closed)', () => {
        const { resolveOpenAIRuntime } = ralph;

        it('дефолты: песочница danger-full-access и env OPENAI_API_KEY', () => {
            const r = resolveOpenAIRuntime(
                { model: 'gpt-5-codex' },
                { OPENAI_API_KEY: 'sk-openai' },
                throwingFail,
            );
            expect(r.model).toBe('gpt-5-codex');
            expect(r.sandboxMode).toBe('danger-full-access');
            expect(r.token).toBe('sk-openai');
        });

        it('переопределение sandboxMode/authTokenEnv из конфига', () => {
            const r = resolveOpenAIRuntime(
                {
                    model: 'gpt-5-codex',
                    sandboxMode: 'workspace-write',
                    authTokenEnv: 'MY_OPENAI_KEY',
                },
                { MY_OPENAI_KEY: 'sk-custom' },
                throwingFail,
            );
            expect(r.sandboxMode).toBe('workspace-write');
            expect(r.token).toBe('sk-custom');
        });

        it('отсутствующая/пустая модель → fail (скрытый дефолт codex недопустим, инвариант №1)', () => {
            expect(() => resolveOpenAIRuntime({}, { OPENAI_API_KEY: 'x' }, throwingFail)).toThrow(
                /openaiRuntime\.model/,
            );
            expect(() =>
                resolveOpenAIRuntime({ model: '   ' }, { OPENAI_API_KEY: 'x' }, throwingFail),
            ).toThrow(/openaiRuntime\.model/);
        });

        it('отсутствующий ключ OpenAI в env → fail (секреты только из env, инвариант №11)', () => {
            expect(() => resolveOpenAIRuntime({ model: 'gpt-5-codex' }, {}, throwingFail)).toThrow(
                /OPENAI_API_KEY/,
            );
        });

        it('requireToken:false (dry) — без ключа не падает, token=null, но кривая модель всё равно fail', () => {
            const r = resolveOpenAIRuntime({ model: 'gpt-5-codex' }, {}, throwingFail, {
                requireToken: false,
            });
            expect(r.token).toBe(null);
            expect(() =>
                resolveOpenAIRuntime({}, {}, throwingFail, { requireToken: false }),
            ).toThrow(/openaiRuntime\.model/);
        });
    });

    describe('spawnCodex — фактический вызов spawn-функции (граница anti-RCE защиты)', () => {
        let spawnFn;
        beforeEach(() => {
            spawnFn = vi.fn();
            vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
            vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
            vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        });
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('вызывает spawnFn с бинарём codex, shell:false и тем argv-массивом, что построил buildCodexArgs', () => {
            spawnFn.mockReturnValue({ status: 0, stdout: 'ok', stderr: '', signal: null });
            const argv = ralph.buildCodexArgs('задача', {
                model: 'gpt-5-codex',
                sandboxMode: 'danger-full-access',
            });
            ralph.spawnCodex(argv, 60_000, spawnFn);
            expect(spawnFn).toHaveBeenCalledTimes(1);
            const [bin, calledArgs, opts] = spawnFn.mock.calls[0];
            expect(bin).toBe('codex');
            expect(calledArgs).toBe(argv);
            expect(opts.shell).toBe(false);
            expect(opts.timeout).toBe(60_000);
        });

        it('ненулевой exit-код процесса пробрасывается как code; вывод — stdout+stderr', () => {
            spawnFn.mockReturnValue({ status: 2, stdout: '', stderr: 'boom', signal: null });
            expect(ralph.spawnCodex(['exec'], 1000, spawnFn)).toEqual({
                code: 2,
                output: '\nboom',
            });
        });

        it('процесс убит по сигналу (таймаут) → code:1, не бросает исключение', () => {
            spawnFn.mockReturnValue({ status: null, stdout: '', stderr: '', signal: 'SIGTERM' });
            expect(ralph.spawnCodex(['exec'], 1000, spawnFn).code).toBe(1);
        });

        it('с env-аргументом опции spawn несут ровно этот env; без него — ключа env нет', () => {
            spawnFn.mockReturnValue({ status: 0, stdout: 'ok', stderr: '', signal: null });
            const env = { PATH: '/usr/bin', OPENAI_API_KEY: 'sk-x' };
            ralph.spawnCodex(['exec'], 1000, spawnFn, env);
            expect(spawnFn.mock.calls[0][2].env).toBe(env);
            spawnFn.mockClear();
            ralph.spawnCodex(['exec'], 1000, spawnFn);
            expect('env' in spawnFn.mock.calls[0][2]).toBe(false);
        });
    });

    describe('runOpenAIOnce — смоук: кодер-сессия стартует и выдаёт дифф', () => {
        let runtime;
        const savedToken = process.env.OPENAI_API_KEY;

        beforeEach(() => {
            vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
            vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
            vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
            runtime = buildRuntime();
            runtime.setConfigForTests({
                ...REAL_CONFIG,
                permissionMode: 'bypassPermissions',
                openaiRuntime: { model: 'gpt-5-codex' },
            });
            process.env.OPENAI_API_KEY = 'sk-openai-smoke';
        });
        afterEach(() => {
            vi.restoreAllMocks();
            if (savedToken === undefined) delete process.env.OPENAI_API_KEY;
            else process.env.OPENAI_API_KEY = savedToken;
        });

        it('спавнит `codex` с моделью OpenAI и ключом в env, возвращает дифф, ключ НЕ в argv', () => {
            const spawnFn = vi.fn(() => ({
                status: 0,
                stdout: 'diff --git a/f b/f\n+добавлено',
                stderr: '',
                signal: null,
            }));

            const res = runtime.runOpenAIOnce('тестовая задача', { maxTurns: 5 }, spawnFn);

            expect(res).toEqual({ code: 0, output: 'diff --git a/f b/f\n+добавлено\n' });
            expect(spawnFn).toHaveBeenCalledTimes(1);
            const [bin, argv, opts] = spawnFn.mock.calls[0];
            expect(bin).toBe('codex');
            // Модель — OpenAI из openaiRuntime.model, а НЕ claude-модель из modelRouting.
            expect(argv).toContain('-m');
            expect(argv[argv.indexOf('-m') + 1]).toBe('gpt-5-codex');
            expect(argv).toContain('exec');
            // Ключ ушёл env'ом, не в argv (иначе виден в /proc/*/cmdline).
            expect(argv.join(' ')).not.toContain('sk-openai-smoke');
            expect(opts.shell).toBe(false);
            expect(opts.env.OPENAI_API_KEY).toBe('sk-openai-smoke');
        });

        it('НЕ тащит Claude-флаги --max-turns/--fallback-model в codex argv (риск #3)', () => {
            const spawnFn = vi.fn(() => ({ status: 0, stdout: 'ok', stderr: '', signal: null }));
            runtime.runOpenAIOnce('x', { maxTurns: 1 }, spawnFn);
            const [, argv] = spawnFn.mock.calls[0];
            expect(argv).not.toContain('--max-turns');
            expect(argv).not.toContain('--fallback-model');
        });

        it('выбор coderRuntime:openai в конфиге даёт OpenAI-адаптер из реестра', () => {
            const openaiRuntime = buildRuntime();
            const adapters = openaiRuntime.buildAdapters(
                {
                    taskSource: { github: { x: 1 } },
                    gate: { npm: { x: 1 } },
                    notifier: { telegram: { x: 1 } },
                    deployCheck: { 'github-actions': { x: 1 } },
                    coderRuntime: {
                        claude: { run: () => ({ code: 0, output: 'claude' }) },
                        openai: { run: () => ({ code: 0, output: 'openai' }) },
                    },
                },
                openaiRuntime.resolveAdapterSelection({ coderRuntime: 'openai' }, throwingFail),
                throwingFail,
            );
            expect(adapters.coderRuntime.run('p', { maxTurns: 1 }).output).toBe('openai');
        });
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

    it('#224: текст события остаётся в логе даже когда доставка (все ретраи нотифаера) провалилась', () => {
        // 🔔 PUSH печатается ПЕРВОЙ строкой pushEvent, до вызова sendFn — недоставка
        // (в т.ч. исчерпание ретраев telegram-notifier) не должна стирать событие
        // из ralph.log, иначе разбор постфактум не находит, что вообще произошло.
        const sendFn = vi.fn().mockReturnValue(false);
        const logFn = vi.fn();
        pushEvent(
            'громкое событие, которое нельзя потерять',
            { profileName: 'prod' },
            {
                sendFn,
                logFn,
            },
        );
        expect(
            logFn.mock.calls.some(([msg]) =>
                msg.includes('громкое событие, которое нельзя потерять'),
            ),
        ).toBe(true);
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
        // #204-ревью: preflight валидирует состав гейта на старте (resolveGateChecks) —
        // валидный блок gate нужен «зелёному» пути, как phases/authorAllowlist.
        gate: { checks: [['test', 'npm run test']] },
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
            const cfg = validCfg({
                profileName: 'prod',
                deployCheck: { healthUrl: 'https://app.example.test' },
            });
            expect(() => preflight(cfg, okDeps({ loadStateFn: fakeState }))).not.toThrow();
        });

        it('#204-ревью: prod без валидного deployCheck.healthUrl → fail (пост-мердж healthcheck обязателен)', () => {
            process.env.RALPH_TG_BOT_TOKEN = '123456789:AAExampleTokenLooksLikeThisThirtyPlusChars';
            process.env.RALPH_TG_CHAT_ID = '-1001234567890';
            const cfg = validCfg({ profileName: 'prod' }); // deployCheck.healthUrl не задан
            expect(() => preflight(cfg, okDeps({ loadStateFn: fakeState }))).toThrow(/healthUrl/);
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

    it('#204-ревью: битый/забытый блок gate → fail на СТАРТЕ (resolveGateChecks в preflight)', () => {
        // Ранний отказ, а не спустя часы в tryMergePhase: свежий порт с кривым конфигом
        // должен упасть при запуске, как на authorAllowlist/TG.
        const cfg = validCfg({ gate: undefined });
        expect(() => preflight(cfg, okDeps({ loadStateFn: fakeState }))).toThrow(/gate/);
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

    it('#165 барьер: state.deployBlock задан → пуш на старте + fail (следующая фаза не начинается)', () => {
        const state = {
            count: 0,
            milestone: 'M2',
            submitted: false,
            noProgress: 0,
            deployBlock: {
                milestone: 'M1',
                sha: 'a'.repeat(40),
                status: 'completed',
                conclusion: 'failure',
                url: 'https://gh/run/1',
                reason: 'workflow completed (failure)',
            },
        };
        const pushEventFn = vi.fn();
        expect(() =>
            preflight(validCfg(), okDeps({ loadStateFn: () => state, pushEventFn })),
        ).toThrow(/деплой.*красн|#165/i);
        // допушивает на старте — страховка от потерянного пуша прошлого прогона
        expect(pushEventFn).toHaveBeenCalledTimes(1);
        expect(pushEventFn.mock.calls[0][0]).toMatch(/aaaaaaaa/);
    });

    it('#165 --deploy-resolved → снимает блок через saveStateFn, fail не бросается', () => {
        const state = {
            count: 0,
            milestone: 'M2',
            submitted: false,
            noProgress: 0,
            deployBlock: { milestone: 'M1', reason: 'workflow timeout', sha: null, url: null },
        };
        const saveStateFn = vi.fn();
        const pushEventFn = vi.fn();
        expect(() =>
            preflight(
                validCfg(),
                okDeps({
                    loadStateFn: () => state,
                    saveStateFn,
                    pushEventFn,
                    deployResolved: true,
                    // фаза M2 — идёт проверка C4 предыдущей M1; phaseMergedFn=true (okDeps)
                    phaseIndexOfFn: () => 0,
                }),
            ),
        ).not.toThrow();
        expect(state.deployBlock).toBe(null);
        expect(saveStateFn).toHaveBeenCalledWith(state);
        // барьер снят → красного пуша на старте нет
        expect(pushEventFn).not.toHaveBeenCalled();
    });

    it('#165 --deploy-resolved без активного блока → флаг проигнорирован, не падает', () => {
        const state = { count: 0, milestone: 'M1', submitted: false, noProgress: 0 };
        const logs = [];
        expect(() =>
            preflight(
                validCfg(),
                okDeps({
                    loadStateFn: () => state,
                    logFn: (m) => logs.push(m),
                    deployResolved: true,
                }),
            ),
        ).not.toThrow();
        expect(logs.join('\n')).toMatch(/проигнорирован/);
    });

    it('#165 без deployBlock → барьера нет, зелёный старт проходит', () => {
        const state = { count: 0, milestone: 'M1', submitted: false, noProgress: 0 };
        const pushEventFn = vi.fn();
        expect(() =>
            preflight(validCfg(), okDeps({ loadStateFn: () => state, pushEventFn })),
        ).not.toThrow();
        expect(pushEventFn).not.toHaveBeenCalled();
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
        // #204: heal-пути runLoop собирают список чеков из gateChecksFor(cfg.profileName, cfg),
        // а состав теперь в конфиге — cfg нужен валидный gate-блок (иначе fail-closed).
        gate: {
            checks: [
                ['build', 'npm run build'],
                ['test', 'npm run test'],
            ],
            prodChecks: [['e2e', 'CI=1 npm run test:e2e']],
            prodDropChecks: ['test'],
        },
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
            // #193: обновление дерева раннера после мерджа идёт через argv-коллаборатор.
            runArgvFn: () => '',
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
            // #217: снятие label blocked — побочка (gh), в тестах заглушка. Реальный
            // removeBlockedLabel зовёт sh и попал бы в предохранитель #138.
            removeBlockedLabelFn: () => {},
            runClaudeFn: () => 0,
            ensureCleanFn: () => true,
            phaseMergedFn: () => false,
            // #237: тот же безопасный дефолт — настоящий mergedPhasePr зовёт ghJson → sh,
            // и тест на пути «фаза уже смерджена» ловил бы предохранитель #138.
            mergedPhasePrFn: () => null,
            advancePhaseFn: () => {},
            tryMergePhaseFn: () => 'not-merged',
            closeMilestoneByTitleFn: () => {},
            // #199: тот же безопасный дефолт, что у pushEventFn ниже — настоящий
            // syncProjectBoard зовёт sh('node scripts/project-sync.mjs'), и каждый
            // тест, доходящий до gate === 'merged', ловил бы предохранитель #138.
            syncProjectBoardFn: () => {},
            // #169: тот же безопасный дефолт — настоящий recordReviewFindings зовёт
            // sh('node scripts/review-findings-journal.mjs ...'), и каждый тест, доходящий
            // до gate === 'merged', ловил бы предохранитель #138 (даже через try/catch —
            // guardSideEffect пишет попытку в журнал ДО throw).
            recordReviewFindingsFn: () => {},
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
            // #163: безопасные заглушки пост-мердж проверки — без них prod-сценарий,
            // доходящий до gate === 'merged', звал бы НАСТОЯЩИЕ mergedShaOf/waitForDeployRun
            // (реальные gh-чтения через sh → предохранитель #138).
            mergedShaOfFn: () => 'a'.repeat(40),
            waitForDeployRunFn: () => ({ status: 'completed', conclusion: 'success' }),
            // #164: тот же безопасный дефолт-паттерн — без него prod-сценарий с зелёным
            // workflow (conclusion: 'success' выше) звал бы НАСТОЯЩИЙ checkProdHealth
            // (реальный curl к https://pixeltanks.ru).
            checkProdHealthFn: () => ({ ok: true, status: 200, url: 'https://pixeltanks.ru' }),
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
                // #193: обновление дерева раннера — argv, нормализуем в строку.
                runArgvFn: (file, args) => {
                    shCmds.push(`${file} ${args.join(' ')}`);
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

    it('#237 фаза уже смерджена → recordReviewFindings зовётся с номером PR из mergedPhasePr', () => {
        const logs = [];
        const recordReviewFindingsFn = vi.fn();
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => true,
                mergedPhasePrFn: () => 315,
                recordReviewFindingsFn,
                shFn: () => '',
            }),
        );
        expect(recordReviewFindingsFn).toHaveBeenCalledTimes(1);
        expect(recordReviewFindingsFn.mock.calls[0][1]).toBe(315);
    });

    it('#237 фаза уже смерджена, номер PR не определён → предупреждение, запись не зовётся', () => {
        const logs = [];
        const recordReviewFindingsFn = vi.fn();
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => true,
                mergedPhasePrFn: () => null,
                recordReviewFindingsFn,
                shFn: () => '',
            }),
        );
        expect(recordReviewFindingsFn).not.toHaveBeenCalled();
        expect(logs.join('\n')).toMatch(/запись отсутствует/);
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
                // #193: dry не должен звать argv-мутации обновления дерева — фиксируем и их.
                runArgvFn: (file, args) => {
                    shCmds.push(`${file} ${args.join(' ')}`);
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

    // #221: основное ревью (не разбор blocked) получает СВОЙ фолбэк review.fallback —
    // явным опции.fallbackModel, а не через общий cfg.fallbackModel/noFallback (M8).
    // Факт использования фолбэка обязан быть виден в логе (issue #221, критерий 1).
    it('#221: основное ревью получает fallbackModel из review.fallback, видно в логе', () => {
        const logs = [];
        const runClaudeFn = vi.fn(() => 0);
        runLoop(
            validCfg({
                fallbackModel: 'claude-sonnet-5', // общий фолбэк — НЕ должен утечь в ревью
                review: { default: 'claude-opus-4-8', fallback: 'claude-fable-5' },
            }),
            ctx(mkState()),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'claude-opus-4-8',
                runClaudeFn,
                tryMergePhaseFn: () => 'merged',
            }),
        );
        // Вызов 0 — создание PR, вызов 1 — ревью.
        expect(runClaudeFn.mock.calls[1][1].model).toBe('claude-opus-4-8');
        expect(runClaudeFn.mock.calls[1][1].fallbackModel).toBe('claude-fable-5');
        expect(logs.join('\n')).toMatch(
            /Ревью фазы моделью: claude-opus-4-8.*фолбэк при overload: claude-fable-5/,
        );
    });

    // #221 критерий 3: общий cfg.fallbackModel не должен влиять на ревью, когда
    // review.fallback вообще не задан — pickReviewFallbackModel дефолтит на
    // review.default, а НЕ на cfg.fallbackModel.
    it('#221: без review.fallback общий cfg.fallbackModel в ревью не попадает — дефолт на review.default', () => {
        const runClaudeFn = vi.fn(() => 0);
        runLoop(
            validCfg({
                fallbackModel: 'claude-sonnet-5',
                review: { default: 'claude-opus-4-8' },
            }),
            ctx(mkState()),
            deps([], {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'claude-opus-4-8',
                runClaudeFn,
                tryMergePhaseFn: () => 'merged',
            }),
        );
        expect(runClaudeFn.mock.calls[1][1].fallbackModel).toBe('claude-opus-4-8');
        expect(runClaudeFn.mock.calls[1][1].fallbackModel).not.toBe('claude-sonnet-5');
    });

    // #169: журнал находок ревью — запись пишется сразу при мердже фазы, тем же приёмом,
    // что closeMilestoneByTitle/syncProjectBoard (единая точка gate === 'merged').
    it('#169 гейт merged → recordReviewFindingsFn зовётся с фазой и номером PR из гейта', () => {
        const recordReviewFindingsFn = vi.fn();
        runLoop(
            validCfg(),
            ctx(mkState()),
            deps([], {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                getLastGatePr: () => 42,
                recordReviewFindingsFn,
            }),
        );
        expect(recordReviewFindingsFn).toHaveBeenCalledTimes(1);
        expect(recordReviewFindingsFn.mock.calls[0][0]).toMatchObject({ milestone: 'M1' });
        expect(recordReviewFindingsFn.mock.calls[0][1]).toBe(42);
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

    it('#163 prod: после merged раннер дожидается итога deploy-workflow на смердженном sha', () => {
        const logs = [];
        const mergedShaOfFn = vi.fn(() => 'a'.repeat(40));
        const waitForDeployRunFn = vi.fn(() => ({ status: 'completed', conclusion: 'success' }));
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                mergedShaOfFn,
                waitForDeployRunFn,
            }),
        );
        // sha мерджа получен и передан в ожидание итога workflow.
        expect(mergedShaOfFn).toHaveBeenCalledTimes(1);
        expect(waitForDeployRunFn).toHaveBeenCalledTimes(1);
        expect(waitForDeployRunFn.mock.calls[0][0]).toBe('a'.repeat(40));
        expect(logs.join('\n')).toMatch(/итог workflow — completed \(success\)/);
    });

    it('#163 prod: сбой получения sha/итога деплоя не роняет loop — логируется и стоп перед деплоем', () => {
        const logs = [];
        const waitForDeployRunFn = vi.fn();
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                mergedShaOfFn: () => {
                    throw new Error('gh недоступен');
                },
                waitForDeployRunFn,
            }),
        );
        // sha получить не удалось → ожидание итога не зовём, но loop не падает.
        expect(waitForDeployRunFn).not.toHaveBeenCalled();
        expect(logs.join('\n')).toMatch(/не удалось дождаться итога деплоя/);
        // Не удалось подтвердить деплой = красный (fail-closed) → красный текст стопа.
        expect(logs.join('\n')).toMatch(/стоп: деплой красный/);
    });

    it('#164 prod: зелёный workflow (conclusion success) → healthcheck прода зовётся', () => {
        const logs = [];
        const checkProdHealthFn = vi.fn(() => ({ ok: true, status: 200, url: 'u' }));
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                waitForDeployRunFn: () => ({ status: 'completed', conclusion: 'success' }),
                checkProdHealthFn,
            }),
        );
        expect(checkProdHealthFn).toHaveBeenCalledTimes(1);
    });

    it('#164 prod: упавший workflow (conclusion failure) → healthcheck НЕ зовётся, красный итог уже сигнал сам по себе', () => {
        const logs = [];
        const checkProdHealthFn = vi.fn();
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                waitForDeployRunFn: () => ({ status: 'completed', conclusion: 'failure' }),
                checkProdHealthFn,
            }),
        );
        expect(checkProdHealthFn).not.toHaveBeenCalled();
    });

    it('#164 prod: недосмотренный workflow (status timeout) → healthcheck НЕ зовётся', () => {
        const logs = [];
        const checkProdHealthFn = vi.fn();
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                waitForDeployRunFn: () => ({ status: 'timeout', conclusion: null }),
                checkProdHealthFn,
            }),
        );
        expect(checkProdHealthFn).not.toHaveBeenCalled();
    });

    it('#165 prod: упавший workflow → барьер в state.deployBlock + пуш с sha и итогом, стоп', () => {
        const logs = [];
        const saved = [];
        const pushEventFn = vi.fn();
        const state = mkState();
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                saveStateFn: (s) => saved.push({ ...s }),
                waitForDeployRunFn: () => ({
                    status: 'completed',
                    conclusion: 'failure',
                    sha: 'a'.repeat(40),
                    url: 'https://gh/run/1',
                }),
                pushEventFn,
            }),
        );
        // барьер сохранён в state
        expect(state.deployBlock).toMatchObject({ milestone: 'M1', conclusion: 'failure' });
        expect(saved.some((s) => s.deployBlock)).toBe(true);
        // пуш с sha и итогом workflow — критерий #165
        const redPush = pushEventFn.mock.calls.find((c) => /деплой красный/.test(c[0]));
        expect(redPush).toBeTruthy();
        expect(redPush[0]).toMatch(/aaaaaaaa/); // укороченный sha
        expect(redPush[0]).toMatch(/failure/);
        expect(logs.join('\n')).toMatch(/стоп: деплой красный/);
    });

    it('#165 prod: недосмотренный workflow (timeout) → тоже барьер + пуш', () => {
        const logs = [];
        const pushEventFn = vi.fn();
        const state = mkState();
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                waitForDeployRunFn: () => ({
                    status: 'timeout',
                    conclusion: null,
                    sha: 'b'.repeat(40),
                }),
                pushEventFn,
            }),
        );
        expect(state.deployBlock).toMatchObject({ milestone: 'M1', status: 'timeout' });
        expect(pushEventFn.mock.calls.some((c) => /деплой красный/.test(c[0]))).toBe(true);
    });

    it('#165 prod: зелёный workflow + здоровый прод → барьера НЕТ, красного пуша нет', () => {
        const logs = [];
        const pushEventFn = vi.fn();
        const state = mkState();
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                waitForDeployRunFn: () => ({
                    status: 'completed',
                    conclusion: 'success',
                    sha: 'a'.repeat(40),
                }),
                checkProdHealthFn: () => ({ ok: true, status: 200, url: 'u' }),
                pushEventFn,
            }),
        );
        expect(state.deployBlock == null).toBe(true);
        expect(pushEventFn.mock.calls.some((c) => /деплой красный/.test(c[0]))).toBe(false);
        // при этом обычный пуш «готова к релизу» уходит
        expect(pushEventFn.mock.calls.some((c) => /готова к релизу/.test(c[0]))).toBe(true);
    });

    it('#165 prod: зелёный workflow, но прод не отвечает → барьер + пуш', () => {
        const state = mkState();
        const pushEventFn = vi.fn();
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(state),
            deps([], {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                waitForDeployRunFn: () => ({
                    status: 'completed',
                    conclusion: 'success',
                    sha: 'a'.repeat(40),
                }),
                checkProdHealthFn: () => ({ ok: false, status: 502, url: 'u' }),
                pushEventFn,
            }),
        );
        expect(state.deployBlock).toBeTruthy();
        expect(state.deployBlock.reason).toMatch(/прод не отвечает/);
        expect(pushEventFn.mock.calls.some((c) => /деплой красный/.test(c[0]))).toBe(true);
    });

    it('#165 prod: сбой чтения итога (mergedShaOf бросает) → fail-closed барьер + пуш, не тихий пропуск', () => {
        const state = mkState();
        const pushEventFn = vi.fn();
        runLoop(
            validCfg({ profileName: 'prod' }),
            ctx(state),
            deps([], {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                mergedShaOfFn: () => {
                    throw new Error('gh недоступен');
                },
                pushEventFn,
            }),
        );
        expect(state.deployBlock).toMatchObject({ status: 'error' });
        expect(state.deployBlock.reason).toMatch(/ошибка проверки деплоя/);
        expect(pushEventFn.mock.calls.some((c) => /деплой красный/.test(c[0]))).toBe(true);
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

    it('#249 prod: haltBeforeDeploy=true (явно) → стоп после фазы, документированный «либо true»', () => {
        // Undefined-дефолт покрыт тестом #87 выше; здесь — явный true. Документация
        // обещает «не задан ЛИБО true», и регрессию при будущей правке условия `!== false`
        // поймает именно явный кейс (undefined его не отличит от прочих falsy-путей).
        const logs = [];
        const phaseIndexOfFn = vi.fn(() => 0);
        runLoop(
            validCfg({ profileName: 'prod', haltBeforeDeploy: true }),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                waitForDeployRunFn: () => ({ status: 'completed', conclusion: 'success' }),
                checkProdHealthFn: () => ({ ok: true, status: 200, url: 'u' }),
            }),
        );
        // Явный true = #87: стоп сразу после фазы, вторая фаза этим же процессом не начинается.
        expect(phaseIndexOfFn).toHaveBeenCalledTimes(1);
        expect(logs.join('\n')).toMatch(/остановлен перед деплоем/);
    });

    it('#249 prod: haltBeforeDeploy=false + зелёный пост-мердж деплой → фазы катятся подряд без рестарта', () => {
        const logs = [];
        // Счётчик-замыкание (как дефолтный deps.phaseIndexOfFn): фаза 0, затем 1, затем
        // «за концом» массива → break. Прозрачнее самоссылки на mock.calls.length.
        let i = 0;
        const phaseIndexOfFn = vi.fn(() => (i < 2 ? i++ : 99));
        const deployPhaseFn = vi.fn();
        const advancePhaseFn = vi.fn();
        runLoop(
            validCfg({
                profileName: 'prod',
                haltBeforeDeploy: false,
                phases: [
                    { milestone: 'M1', branch: 'feature/m1' },
                    { milestone: 'M2', branch: 'feature/m2' },
                ],
            }),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                waitForDeployRunFn: () => ({ status: 'completed', conclusion: 'success' }),
                checkProdHealthFn: () => ({ ok: true, status: 200, url: 'u' }),
                deployPhaseFn,
                advancePhaseFn,
            }),
        );
        // Обе фазы отработаны в одном процессе — без остановки между ними.
        expect(deployPhaseFn).toHaveBeenCalledTimes(2);
        expect(advancePhaseFn).toHaveBeenCalledTimes(2);
        expect(logs.join('\n')).not.toMatch(/loop остановлен перед деплоем/);
        expect(logs.join('\n')).toMatch(/haltBeforeDeploy=false — продолжаю без остановки/);
        expect(logs.join('\n')).toMatch(/Все фазы завершены/);
    });

    it('#249 prod: haltBeforeDeploy=false, но пост-мердж деплой красный → трек всё равно стопорится (fail-closed)', () => {
        const logs = [];
        const phaseIndexOfFn = vi.fn(() => 0);
        const pushEventFn = vi.fn();
        runLoop(
            validCfg({
                profileName: 'prod',
                haltBeforeDeploy: false,
                phases: [
                    { milestone: 'M1', branch: 'feature/m1' },
                    { milestone: 'M2', branch: 'feature/m2' },
                ],
            }),
            ctx(mkState()),
            deps(logs, {
                phaseIndexOfFn,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'none',
                runClaudeFn: () => 0,
                tryMergePhaseFn: () => 'merged',
                waitForDeployRunFn: () => ({
                    status: 'completed',
                    conclusion: 'failure',
                    sha: 'a'.repeat(40),
                }),
                pushEventFn,
            }),
        );
        // Красный деплой стопорит трек несмотря на haltBeforeDeploy=false — вторая фаза не
        // начинается этим же процессом (phaseIndexOfFn зовётся ровно 1 раз).
        expect(phaseIndexOfFn).toHaveBeenCalledTimes(1);
        // Красный исход даёт СВОЙ текст стопа (деплой уже случился и он красный), а не
        // общее «остановлен перед деплоем» флага halt.
        expect(logs.join('\n')).toMatch(/стоп: деплой красный.*--deploy-resolved/s);
        expect(logs.join('\n')).not.toMatch(/loop остановлен перед деплоем/);
        expect(logs.join('\n')).not.toMatch(/haltBeforeDeploy=false — продолжаю без остановки/);
        expect(pushEventFn.mock.calls.some((c) => /деплой красный/.test(c[0]))).toBe(true);
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

    it('#217: гейт blocked → чини-сессия + повторное ревью раннером, снятие метки раннером, инкремент', () => {
        const logs = [];
        // lastReviewModel — модель, поставившая блок (её и подымет планка).
        const state = mkState({
            submitted: true,
            blockedHeals: 0,
            lastReviewModel: 'claude-opus-4-8',
        });
        const runClaudeFn = vi.fn(() => 0);
        const removeBlockedLabelFn = vi.fn();
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'blocked',
                pickReviewModelFn: () => 'claude-opus-4-8',
                runClaudeFn,
                removeBlockedLabelFn,
            }),
        );
        expect(state.blockedHeals).toBe(1);
        // #217: submitted НЕ сбрасывается — следующий проход идёт сразу на гейт, который
        // перечитает метку, выставленную повторным ревью раннера.
        expect(state.submitted).toBe(true);
        // Две сессии: чини-сессия блокеров + повторное ревью раннером.
        expect(runClaudeFn).toHaveBeenCalledTimes(2);
        // Чини-сессии явно запрещено снимать метку — это делает раннер.
        expect(runClaudeFn.mock.calls[0][0]).toMatch(/label blocked НЕ снимай/);
        // Второй вызов — повторное ревью: вешает blocked заново, если блокеры остались.
        expect(runClaudeFn.mock.calls[1][0]).toMatch(/повторн|устранен/i);
        // Метку снял РАННЕР (не кодер-сессия), перед повторным ревью.
        expect(removeBlockedLabelFn).toHaveBeenCalledTimes(1);
        expect(removeBlockedLabelFn.mock.calls[0][0]).toBe('feature/m1');
        // Планка поднята до модели, поставившей блок.
        expect(state.reviewModelFloor).toBe('claude-opus-4-8');
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
                getLastGatePr: () => 555,
                runClaudeFn,
                pushEventFn,
            }),
        );
        expect(runClaudeFn).not.toHaveBeenCalled();
        expect(state.blockedHeals).toBe(0);
        // #86: событие «blocked отдан человеку» уходит пушем (единственный логгер).
        expect(pushEventFn).toHaveBeenCalledTimes(1);
        expect(pushEventFn.mock.calls[0][0]).toMatch(/blocked устоял/);
        // #218 (критерий 2): текст называет число ревью, PR и версию про зацикливание —
        // иначе человек по привычке ищет дефект в коде, хотя проблема может быть в
        // споре ревьюера с правками, а не в самом коде.
        expect(pushEventFn.mock.calls[0][0]).toContain('#555');
        expect(pushEventFn.mock.calls[0][0]).toMatch(/3 повторных ревью/);
        expect(pushEventFn.mock.calls[0][0]).toMatch(/зациклилось/);
    });

    // #216: prod (с включённым разбором) блокер запускает чини-сессию, а не немедленный
    // стоп человеку. Тестируем именно поведение при profileName='prod' + ненулевом лимите.
    it('#216: prod с включённым разбором → блокер запускает разбор+повторное ревью, человека не зовём', () => {
        const logs = [];
        const state = mkState({
            submitted: true,
            blockedHeals: 0,
            lastReviewModel: 'claude-opus-4-8',
        });
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
                pickReviewModelFn: () => 'claude-opus-4-8',
                runClaudeFn,
                pushEventFn,
            }),
        );
        expect(runClaudeFn).toHaveBeenCalledTimes(2); // разбор + повторное ревью
        expect(state.blockedHeals).toBe(1);
        expect(pushEventFn).not.toHaveBeenCalled(); // блокер не ушёл человеку
    });

    // #216: счётчик не в памяти процесса — новое значение уходит в state ДО чини-сессии,
    // поэтому перезапуск раннера посреди разбора его не обнулит (loadState прочитает 2).
    it('#216: инкремент blockedHeals персистится через saveState (переживает перезапуск)', () => {
        const logs = [];
        const state = mkState({
            submitted: true,
            blockedHeals: 1,
            lastReviewModel: 'claude-opus-4-8',
        });
        const saved = [];
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'blocked',
                pickReviewModelFn: () => 'claude-opus-4-8',
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
                // #223: red-checks — пост-меточный исход, tryMergePhase уже прочитал PR
                // (lastGatePr выставлен) и лишь потом упёрся в чеки. Сброс blockedHeals
                // теперь требует getLastGatePr() !== null (пуш «снят автоматически» не
                // должен стрелять на путях, где метку гейт не читал) — симулируем номер.
                getLastGatePr: () => 909,
                getLastRedCheck: () => ({ name: 'test', cmd: 'npm run test', excerpt: 'boom' }),
                runClaudeFn: () => 0,
            }),
        );
        expect(state.blockedHeals).toBe(0);
    });

    // #218 (критерий 1): «блокер снят автоматически» — отдельное событие, не то же
    // самое, что общий пуш о состоянии гейта. Гейт дошёл до red-checks БЕЗ label
    // blocked при blockedHeals > 0 — значит повторное ревью раннера блок не оставило,
    // и это надо назвать явно: номер PR + модель ревью, чтобы человек не тратил время
    // разбираясь, что вообще произошло.
    it('#218: гейт red-checks после разбора blocked → пуш «снят автоматически» с PR и моделью ревью', () => {
        const logs = [];
        const state = mkState({
            submitted: true,
            blockedHeals: 2,
            lastReviewModel: 'claude-opus-4-8',
        });
        const pushEventFn = vi.fn();
        runLoop(
            validCfg({ blockedHealAttempts: 3, gateHealAttempts: 2 }),
            ctx(state),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'red-checks',
                getLastRedCheck: () => ({ name: 'test', cmd: 'npm run test', excerpt: 'boom' }),
                getLastGatePr: () => 321,
                runClaudeFn: () => 0,
                pushEventFn,
            }),
        );
        expect(state.blockedHeals).toBe(0);
        const liftedMsg = pushEventFn.mock.calls
            .map((c) => c[0])
            .find((m) => m.includes('снят автоматически'));
        expect(liftedMsg).toBeDefined();
        expect(liftedMsg).toContain('#321');
        expect(liftedMsg).toContain('claude-opus-4-8');
    });

    // #218: тот же барьер, но по пути gate === 'merged' — повторное ревью прошло
    // чисто и гейт домерджил фазу СРАЗУ, минуя red-checks. Пуш о снятом блокере
    // должен уйти отдельно от пуша «фаза смерджена» — это два разных события.
    it('#218: гейт merged после разбора blocked → отдельный пуш «снят автоматически» с PR и моделью ревью', () => {
        const logs = [];
        const state = mkState({
            submitted: true,
            blockedHeals: 1,
            lastReviewModel: 'claude-opus-4-8',
        });
        const pushEventFn = vi.fn();
        let gateCalls = 0;
        const tryMergePhaseFn = vi.fn(() => (gateCalls++ === 0 ? 'blocked' : 'merged'));
        let idxCalls = 0;
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => (idxCalls++ < 2 ? 0 : 99),
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'claude-opus-4-8',
                tryMergePhaseFn,
                runClaudeFn: () => 0,
                pushEventFn,
                getLastGatePr: () => 217,
            }),
        );
        const messages = pushEventFn.mock.calls.map((c) => c[0]);
        const liftedMsg = messages.find((m) => m.includes('снят автоматически'));
        const mergedMsg = messages.find((m) => m.includes('смерджена в main'));
        expect(liftedMsg).toBeDefined();
        expect(liftedMsg).toContain('#217');
        expect(liftedMsg).toContain('claude-opus-4-8');
        // Два РАЗНЫХ события пушем, не одно слитое сообщение.
        expect(mergedMsg).toBeDefined();
        expect(mergedMsg).not.toBe(liftedMsg);
    });

    // #222: hold — человеческий стоп-кран. Гейт стоп + пуш, БЕЗ чини-сессий, БЕЗ
    // повторного ревью, счётчики blockedHeals/gateHeals не трогаются.
    it('#222: гейт hold → стоп + пуш с номером PR, ни одной сессии не запущено', () => {
        const logs = [];
        const state = mkState({ submitted: true, blockedHeals: 0, gateHeals: 0 });
        const runClaudeFn = vi.fn(() => 0);
        const removeBlockedLabelFn = vi.fn();
        const pushEventFn = vi.fn();
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'hold',
                getLastGatePr: () => 909,
                runClaudeFn,
                removeBlockedLabelFn,
                pushEventFn,
            }),
        );
        expect(runClaudeFn).not.toHaveBeenCalled();
        expect(removeBlockedLabelFn).not.toHaveBeenCalled();
        expect(state.blockedHeals).toBe(0);
        expect(state.gateHeals).toBe(0);
        expect(pushEventFn).toHaveBeenCalledTimes(1);
        const msg = pushEventFn.mock.calls[0][0];
        expect(msg).toContain('#909');
        expect(msg).toMatch(/hold/);
        expect(msg).toMatch(/человек/);
    });

    // #222: hold проверяется в tryMergePhase раньше blocked — если предыдущий круг
    // разбора оставил blockedHeals > 0, а этот проход внезапно видит hold (человек
    // поставил метку параллельно), пуш «блокер снят автоматически» НЕ должен уйти —
    // мы не знаем, снят ли фактически blocked, гейт вообще до него не дошёл.
    it('#222: гейт hold при blockedHeals > 0 НЕ шлёт «снят автоматически», счётчик не трогается', () => {
        const logs = [];
        const state = mkState({
            submitted: true,
            blockedHeals: 2,
            lastReviewModel: 'claude-opus-4-8',
        });
        const pushEventFn = vi.fn();
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'hold',
                getLastGatePr: () => 909,
                runClaudeFn: () => 0,
                pushEventFn,
            }),
        );
        expect(state.blockedHeals).toBe(2); // не сброшен и не увеличен
        const messages = pushEventFn.mock.calls.map((c) => c[0]);
        expect(messages.some((m) => m.includes('снят автоматически'))).toBe(false);
        expect(messages.some((m) => /hold/.test(m))).toBe(true);
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

    // #217 (критерий 2): планка модели повторного ревью. Блок поставила fable; после
    // правок дифф «подешевел» и pickReviewModel даёт haiku. Повторное ревью обязано
    // идти на fable, НЕ на haiku — иначе эскалацию обходят удешевлением ревьюера.
    it('#217: повторное ревью не слабее поставившей блок — haiku-кандидат поднят до fable-планки', () => {
        const logs = [];
        const state = mkState({
            submitted: true,
            blockedHeals: 0,
            lastReviewModel: 'claude-fable-5', // блок поставила fable
        });
        const runClaudeFn = vi.fn(() => 0);
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'blocked',
                pickReviewModelFn: () => 'claude-haiku-4-5-20251001', // слабее блокирующей
                runClaudeFn,
            }),
        );
        expect(state.reviewModelFloor).toBe('claude-fable-5');
        // Второй вызов runClaude — повторное ревью: модель = планка (fable), не haiku.
        expect(runClaudeFn).toHaveBeenCalledTimes(2);
        expect(runClaudeFn.mock.calls[1][1].model).toBe('claude-fable-5');
        // #221: фолбэк повторного ревью тоже поднят до планки (fable) через
        // strongerReviewModel — иначе overload молча деградировал бы модель ниже
        // планки, обходя барьер #217 на уровне CLI-фолбэка. cfg тут без блока review
        // (validCfg), поэтому pickReviewFallbackModel вернул бы null, но
        // strongerReviewModel(null, floor) поднимает его до floor.
        expect(runClaudeFn.mock.calls[1][1].fallbackModel).toBe('claude-fable-5');
    });

    // #221-ревью (PR #241): явное review.fallback: 'none' — honest-стоп, планка floor его
    // НЕ повышает. Иначе осознанный отказ от фолбэка ушёл бы с --fallback-model <floor>,
    // прямо противореча контракту (CLAUDE.md инв. 6). Повторное ревью при 'none' идёт
    // моделью планки, но БЕЗ фолбэка.
    it('#221: явное review.fallback "none" — повторное ревью без фолбэка, планка его не повышает', () => {
        const logs = [];
        const state = mkState({
            submitted: true,
            blockedHeals: 0,
            lastReviewModel: 'claude-fable-5',
        });
        const runClaudeFn = vi.fn(() => 0);
        runLoop(
            validCfg({
                blockedHealAttempts: 3,
                review: { default: 'claude-opus-4-8', fallback: 'none' },
            }),
            ctx(state),
            deps(logs, {
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'blocked',
                pickReviewModelFn: () => 'claude-haiku-4-5-20251001',
                runClaudeFn,
            }),
        );
        // Модель повторного ревью — по-прежнему планка (fable), а вот фолбэк — 'none'
        // (honest-стоп), не поднят до floor.
        expect(runClaudeFn.mock.calls[1][1].model).toBe('claude-fable-5');
        expect(runClaudeFn.mock.calls[1][1].fallbackModel).toBe('none');
    });

    // #217: судить блок нечем (review: none и планки нет) — fail-closed, PR человеку.
    // Без этой ветки метку сняли бы «на слово» и фаза уехала бы в main без ревью.
    it('#217: нет ревью-модели для повторного ревью → fail-closed, человек, не мерджим', () => {
        const logs = [];
        const state = mkState({ submitted: true, blockedHeals: 0, lastReviewModel: null });
        const runClaudeFn = vi.fn(() => 0);
        const pushEventFn = vi.fn();
        const removeBlockedLabelFn = vi.fn();
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => 0,
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                tryMergePhaseFn: () => 'blocked',
                pickReviewModelFn: () => 'none', // ревью-модели нет
                runClaudeFn,
                pushEventFn,
                removeBlockedLabelFn,
            }),
        );
        // Чини-сессия прошла, но повторное ревью невозможно → метку раннер НЕ снимает.
        expect(removeBlockedLabelFn).not.toHaveBeenCalled();
        expect(pushEventFn).toHaveBeenCalledTimes(1);
        expect(pushEventFn.mock.calls[0][0]).toMatch(/повторное ревью blocked невозможно/);
        expect(state.blockedHeals).toBe(0); // отдан человеку
    });

    // #217 (критерий 3): снятая кодер-сессией метка сама по себе к мерджу не ведёт —
    // между блоком и мерджем раннер ОБЯЗАТЕЛЬНО снимает метку сам и гоняет повторное
    // ревью. Мердж наступает только следующим гейтом, после ревью раннера.
    it('#217: метка снята кодером сама → мердж только после повторного ревью раннером', () => {
        const logs = [];
        const state = mkState({
            submitted: true,
            blockedHeals: 0,
            lastReviewModel: 'claude-opus-4-8',
        });
        const runClaudeFn = vi.fn(() => 0);
        const removeBlockedLabelFn = vi.fn();
        const advancePhaseFn = vi.fn();
        // 1-й гейт — blocked; 2-й (после повторного ревью) — merged.
        let gateCalls = 0;
        const tryMergePhaseFn = vi.fn(() => (gateCalls++ === 0 ? 'blocked' : 'merged'));
        // idx 0 на первых двух проходах, затем «за концом» → выход.
        let idxCalls = 0;
        runLoop(
            validCfg({ blockedHealAttempts: 3 }),
            ctx(state),
            deps(logs, {
                phaseIndexOfFn: () => (idxCalls++ < 2 ? 0 : 99),
                openIssuesFn: () => [],
                allOpenIssuesFn: () => [],
                phaseMergedFn: () => false,
                pickReviewModelFn: () => 'claude-opus-4-8',
                tryMergePhaseFn,
                runClaudeFn,
                removeBlockedLabelFn,
                advancePhaseFn,
            }),
        );
        // Мердж состоялся ровно один раз — вторым гейтом, ПОСЛЕ повторного ревью раннера.
        expect(advancePhaseFn).toHaveBeenCalledTimes(1);
        // Раннер сам снял метку (не кодер) перед повторным ревью — ровно один раз.
        expect(removeBlockedLabelFn).toHaveBeenCalledTimes(1);
        // До мерджа прошли обе сессии blocked-цикла: чини + повторное ревью раннера.
        expect(runClaudeFn).toHaveBeenCalledTimes(2);
        expect(runClaudeFn.mock.calls[0][0]).toMatch(/label blocked НЕ снимай/);
        expect(runClaudeFn.mock.calls[1][0]).toMatch(/повторн|устранен/i);
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
        it('паркует detached на origin/main через argv (#193), НЕ занимая ветку main', () => {
            const calls = [];
            parkOnOriginMain({
                runArgvFn: (file, args) => calls.push([file, args]),
                logFn: () => {},
            });
            expect(calls).toEqual([['git', ['checkout', '--detach', 'origin/main']]]);
        });

        it('best-effort: сбой checkout не бросает, только лог', () => {
            const logs = [];
            expect(() =>
                parkOnOriginMain({
                    runArgvFn: () => {
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
                // #193: git fetch/checkout идут через argv-коллаборатор (execFile без
                // шелла). Нормализуем в строку и пишем в тот же shCmds/shImpl, чтобы
                // сценарии (throw на 'git fetch') и ассерты остались прежними по смыслу.
                runArgvFn: (file, args) => {
                    const cmd = `${file} ${args.join(' ')}`;
                    shCmds.push(cmd);
                    return shImpl ? shImpl(cmd) : '';
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
            // #193: argv → в шелл-строку значение не квотируется (shq больше не нужен).
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

        it('#195 критерий (1): git fetch/checkout уходят раздельными элементами argv (границы сохранены)', () => {
            // Рекордер mkDeps выше нормализует argv в строку `args.join(' ')` — границы
            // аргументов стёрты, `['fetch','origin','a b']` и `['fetch','origin','a','b']`
            // дают одну строку. Здесь отдельный рекордер сохраняет argv МАССИВОМ: значение
            // с пробелом осталось бы ОДНИМ элементом, и шелл его не разложил бы. Это и есть
            // структурная защита от shell-инъекции, ради которой фаза перешла на argv.
            const argvCalls = [];
            const { deps } = mkDeps({
                runArgvFn: (file, args) => {
                    argvCalls.push([file, args]);
                    return '';
                },
            });
            expect(checksGreen('feature/m1', 42, deps)).toBe(true);
            expect(argvCalls).toContainEqual(['git', ['fetch', 'origin', 'feature/m1']]);
            expect(argvCalls).toContainEqual(['git', ['checkout', '--detach', SHA_A]]);
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

        // #189: чеки и npm ci исполняют код проверяемого PR — им нельзя видеть секреты
        // петли в env. checksGreen строит санированный env по allowlist один раз на прогон
        // и прокидывает его в чеки и syncDeps; git-хореография гейта остаётся с полным env.
        describe('#189: env-санация чеков гейта', () => {
            const SANITIZED = { PATH: '/usr/bin', SENTINEL: 'sanitized' };

            // Как mkDeps, но фиксирует и второй аргумент shFn (opts) — чтобы отличить
            // чек (санированный env) от git-команды (env не подменён).
            const mkEnvDeps = ({ buildGateEnvFn, syncDepsFn, ...rest } = {}) => {
                const calls = [];
                const parkFn = vi.fn();
                const deps = {
                    shFn: (cmd, opts) => {
                        calls.push([cmd, opts]);
                        if (cmd.startsWith('git rev-parse --verify')) return SHA_A;
                        return '';
                    },
                    // #193: git fetch/checkout — argv, наследуют полный env (opts undefined).
                    // Нормализуем в строку и пишем в тот же calls, чтобы optsOf их находил.
                    runArgvFn: (file, args, opts) => {
                        calls.push([`${file} ${args.join(' ')}`, opts]);
                        return '';
                    },
                    ghJsonFn: () => ({ headRefOid: SHA_A }),
                    logFn: () => {},
                    parkFn,
                    syncDepsFn: syncDepsFn ?? vi.fn(),
                    buildGateEnvFn: buildGateEnvFn ?? (() => SANITIZED),
                    ...rest,
                };
                return { calls, parkFn, deps };
            };

            it('чеки идут с санированным env, git-команды — с полным (env не подменён)', () => {
                const { calls, deps } = mkEnvDeps();
                expect(checksGreen('feature/m1', 42, deps)).toBe(true);
                const optsOf = (needle) =>
                    calls.find(([cmd]) => cmd === needle || cmd.startsWith(needle))?.[1];
                // Чек — с санированным env из buildGateEnvFn.
                expect(optsOf('npm run build')).toEqual({ env: SANITIZED });
                // git fetch/checkout наследуют полный env (нужны секреты для origin).
                expect(optsOf('git fetch')).toBeUndefined();
                expect(optsOf('git checkout --detach')).toBeUndefined();
            });

            it('санированный env прокидывается в syncDeps (npm ci перед чеками)', () => {
                const syncDepsFn = vi.fn();
                const { deps } = mkEnvDeps({ syncDepsFn });
                checksGreen('feature/m1', 42, deps);
                expect(syncDepsFn).toHaveBeenCalledWith({ env: SANITIZED });
            });

            it('fail-closed: buildGateEnvFn бросает (битый allowlist) → false, park, чеки не гонялись', () => {
                const { calls, parkFn, deps } = mkEnvDeps({
                    buildGateEnvFn: () => {
                        throw new Error('битый allowlist');
                    },
                });
                expect(checksGreen('feature/m1', 42, deps)).toBe(false);
                expect(parkFn).toHaveBeenCalled();
                // До чеков не дошли — иначе npm run build ушёл бы с полным env.
                expect(calls.some(([cmd]) => cmd === 'npm run build')).toBe(false);
            });
        });
    });

    describe('gateChecksFor — состав гейта по профилю (#80), из боевого конфига (#204)', () => {
        const names = (checks) => checks.map(([name]) => name);
        // #204: состав чеков переехал в ralph.config.json. Раньше эти ассерты пинили хардкод
        // в gate.ts; теперь они сторожат ШИПНУТЫЙ конфиг — фабричный config засеян боевым
        // выше (setConfigForTests), gateChecksFor читает его через getConfig().

        it('playground = ровно базовые 11 чеков, без толстых; канарейка, дрейф AGENTS.md, храповик, only- и skip-детект первыми (#190, #156, #160, #161, #375)', () => {
            expect(names(gateChecksFor('playground'))).toEqual([
                'security:canary',
                'docs:agents-drift',
                'test:ratchet',
                'test:only-detect',
                'test:skip-detect',
                'build',
                'lint',
                'lint:fsd',
                'typecheck',
                'typecheck:ralph',
                'test',
            ]);
        });

        it('prod = база (без дубля test) + fail-fast security/coverage/e2e', () => {
            expect(names(gateChecksFor('prod'))).toEqual([
                'security:canary',
                'docs:agents-drift',
                'test:ratchet',
                'test:only-detect',
                'test:skip-detect',
                'build',
                'lint',
                'lint:fsd',
                'typecheck',
                'typecheck:ralph',
                'security',
                'coverage',
                'e2e',
            ]);
        });

        it('#190/#156/#160/#161/#375: канарейка, дрейф AGENTS.md, храповик, only- и skip-детект стоят первыми — секундные, красный отменяет мердж до build/e2e', () => {
            // «В начале fail-fast порядка»: канарейка/дрейф AGENTS.md/`vitest list`/`git grep`
            // (секунды каждый) дешевле build (минуты) и e2e (минуты), поэтому упавший чек не
            // оплачивает дорогие следом. Канарейка (#190) — первая: находка секрета важнее любой
            // другой причины красного, и это самая дешёвая проверка из всех (только
            // fs.readFileSync). Дрейф AGENTS.md (#375) — следом: тоже только чтение файлов.
            expect(names(gateChecksFor('playground')).slice(0, 5)).toEqual([
                'security:canary',
                'docs:agents-drift',
                'test:ratchet',
                'test:only-detect',
                'test:skip-detect',
            ]);
            expect(names(gateChecksFor('prod')).slice(0, 5)).toEqual([
                'security:canary',
                'docs:agents-drift',
                'test:ratchet',
                'test:only-detect',
                'test:skip-detect',
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

    describe('findOpenPr — валидация номера PR из внешнего API', () => {
        const { findOpenPr } = ralph;

        it('целый номер PR → возвращает PR как есть', () => {
            const pr = findOpenPr('feature/m1', {
                ghJsonFn: () => [{ number: 5, labels: [] }],
                logFn: () => {},
            });
            expect(pr).toEqual({ number: 5, labels: [] });
        });

        it('номер не похож на целое (argument-injection) → null ДО подстановки в argv/шелл', () => {
            // gh number практически всегда integer, но `--flag`-образное значение gh
            // распарсил бы как флаг: фильтр `/^\d+$/` на входе закрывает канал структурно
            // (тот самый класс, ради которого фаза перешла на argv). Fail-closed.
            const logs = [];
            const pr = findOpenPr('feature/m1', {
                ghJsonFn: () => [{ number: '--delete-branch', labels: [] }],
                logFn: (m) => logs.push(m),
            });
            expect(pr).toBeNull();
            expect(logs.join('\n')).toMatch(/не похож на целое/);
        });

        it('несколько открытых PR → null (fail-closed, разберёт человек)', () => {
            const pr = findOpenPr('feature/m1', {
                ghJsonFn: () => [
                    { number: 5, labels: [] },
                    { number: 6, labels: [] },
                ],
                logFn: () => {},
            });
            expect(pr).toBeNull();
        });

        it('открытого PR нет → null', () => {
            const pr = findOpenPr('feature/m1', { ghJsonFn: () => [], logFn: () => {} });
            expect(pr).toBeNull();
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
                // #193: gh pr merge и пост-мердж git fetch/checkout — argv (execFile без
                // шелла). Нормализуем в строку в тот же shCmds/shImpl: сценарии (throw на
                // 'git fetch origin main') и ассерты остаются прежними по смыслу.
                runArgvFn: (file, args) => {
                    const cmd = `${file} ${args.join(' ')}`;
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
                (c) => c === 'gh pr merge 5 --squash --delete-branch',
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
                `gh pr merge 5 --squash --delete-branch --match-head-commit ${sha}`,
            );
        });

        it('#195 критерий (1): номер PR и sha уходят отдельными элементами argv (границы сохранены)', () => {
            // Как в checksGreen: рекордер mkDeps выше join-ит argv в строку и стирает
            // границы. Здесь argv сохраняется массивом — номер PR и sha отдельными
            // элементами, шелл к ним не прикасается (структурная защита #193), а не
            // квотированием. Пост-мердж git тоже раздельными элементами.
            const sha = 'd'.repeat(40);
            const argvCalls = [];
            const { deps } = mkDeps({
                getVerifiedHeadFn: () => sha,
                runArgvFn: (file, args) => {
                    argvCalls.push([file, args]);
                    return '';
                },
            });
            expect(tryMergePhase(phase, deps)).toBe('merged');
            expect(argvCalls).toContainEqual([
                'gh',
                ['pr', 'merge', '5', '--squash', '--delete-branch', '--match-head-commit', sha],
            ]);
            expect(argvCalls).toContainEqual(['git', ['fetch', 'origin', 'main']]);
            expect(argvCalls).toContainEqual(['git', ['checkout', '--detach', 'origin/main']]);
        });

        it('#SiaTz: sha головы не 40-hex → мерджим без --match-head-commit (не подставляем мусор)', () => {
            const { shCmds, deps } = mkDeps({ getVerifiedHeadFn: () => 'not-a-sha' });
            expect(tryMergePhase(phase, deps)).toBe('merged');
            expect(shCmds).toContain('gh pr merge 5 --squash --delete-branch');
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

        // #222: hold — человеческий стоп-кран, раннер его не снимает никогда.
        it('#222: PR с label hold → hold, чеки не гонялись', () => {
            const checksGreenFn = vi.fn();
            const { deps } = mkDeps({
                findOpenPrFn: () => ({ number: 5, labels: [{ name: 'hold' }] }),
                checksGreenFn,
            });
            expect(tryMergePhase(phase, deps)).toBe('hold');
            expect(checksGreenFn).not.toHaveBeenCalled();
        });

        // #222 критерий 3: hold и blocked одновременно на PR → hold сильнее, стоп без
        // разбора (негативный тест — blocked НЕ должен взять верх).
        it('#222: PR с label hold И blocked одновременно → hold (сильнее), не blocked', () => {
            const checksGreenFn = vi.fn();
            const { deps } = mkDeps({
                findOpenPrFn: () => ({
                    number: 5,
                    labels: [{ name: 'hold' }, { name: 'blocked' }],
                }),
                checksGreenFn,
            });
            expect(tryMergePhase(phase, deps)).toBe('hold');
            expect(checksGreenFn).not.toHaveBeenCalled();
        });

        it('#222: PR с label hold → lastGatePr всё равно выставлен (нужен пушу об остановке)', () => {
            const { deps } = mkDeps({
                findOpenPrFn: () => ({ number: 88, labels: [{ name: 'hold' }] }),
            });
            expect(tryMergePhase(phase, deps)).toBe('hold');
            expect(getLastGatePr()).toBe(88);
        });

        // #218: lastGatePr — источник номера PR для пуша «блокер снят автоматически»
        // в runLoop (getLastGatePr). Тем же приёмом, что lastRedCheck/lastVerifiedHead:
        // выставляется, как только PR найден, сбрасывается В НАЧАЛЕ каждого прогона.
        it('#218: находит PR → lastGatePr = его номер (доступно через getLastGatePr)', () => {
            const { deps } = mkDeps({ findOpenPrFn: () => ({ number: 42, labels: [] }) });
            expect(tryMergePhase(phase, deps)).toBe('merged');
            expect(getLastGatePr()).toBe(42);
        });

        it('#218: PR помечен blocked → lastGatePr всё равно выставлен (нужен пушу об исчерпании лимита)', () => {
            const { deps } = mkDeps({
                findOpenPrFn: () => ({ number: 99, labels: [{ name: 'blocked' }] }),
            });
            expect(tryMergePhase(phase, deps)).toBe('blocked');
            expect(getLastGatePr()).toBe(99);
        });

        it('#218: lastGatePr сбрасывается В НАЧАЛЕ прогона — PR прошлого раунда не подставится в новый', () => {
            const found = mkDeps({ findOpenPrFn: () => ({ number: 7, labels: [] }) });
            expect(tryMergePhase(phase, found.deps)).toBe('merged');
            expect(getLastGatePr()).toBe(7);
            const notFound = mkDeps({ findOpenPrFn: () => null });
            expect(tryMergePhase(phase, notFound.deps)).toBe('not-merged');
            expect(getLastGatePr()).toBeNull();
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

describe('processAlive — занят ли номер процесса (#74, #176)', () => {
    it('сигнал 0 прошёл → процесс жив', () => {
        expect(processAlive(1234, () => undefined)).toBe(true);
    });

    it('сигнал 0 бросил (нет такого процесса) → мёртв', () => {
        expect(
            processAlive(1234, () => {
                throw new Error('ESRCH');
            }),
        ).toBe(false);
    });

    it('пустой/нулевой pid → мёртв, без вызова kill', () => {
        const kill = vi.fn();
        expect(processAlive(0, kill)).toBe(false);
        expect(processAlive(undefined, kill)).toBe(false);
        expect(kill).not.toHaveBeenCalled();
    });
});

describe('cmdlineIncludes — общее тело cmdline-сверок (#176)', () => {
    it('needle есть в /proc/<pid>/cmdline → true, читает нужный путь', () => {
        const readFn = vi.fn(() => 'node\0.claude/ralph/ralph.js\0');
        expect(cmdlineIncludes(77, 'ralph.js', readFn)).toBe(true);
        expect(readFn).toHaveBeenCalledWith('/proc/77/cmdline', 'utf-8');
    });

    it('needle нет → false', () => {
        expect(cmdlineIncludes(77, 'ralph.js', () => 'nginx\0-g\0')).toBe(false);
    });

    it('чтение /proc упало → false', () => {
        expect(
            cmdlineIncludes(77, 'ralph.js', () => {
                throw new Error('ENOENT');
            }),
        ).toBe(false);
    });

    it('пустой/нулевой pid → false без чтения /proc', () => {
        const readFn = vi.fn();
        expect(cmdlineIncludes(0, 'ralph.js', readFn)).toBe(false);
        expect(cmdlineIncludes(undefined, 'ralph.js', readFn)).toBe(false);
        expect(readFn).not.toHaveBeenCalled();
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

describe('acquireRunnerLock — взятие лока первым шагом main() (#178)', () => {
    it('dry=true → true без вызова acquireLockFn (C1: --dry-run не проверяет и не берёт лок)', () => {
        const acquireLockFn = vi.fn(() => true);
        expect(acquireRunnerLock({ dry: true, acquireLockFn })).toBe(true);
        expect(acquireLockFn).not.toHaveBeenCalled();
    });

    it('dry=false, лок свободен → true, передаёт вердикт acquireLockFn', () => {
        const acquireLockFn = vi.fn(() => true);
        expect(acquireRunnerLock({ dry: false, acquireLockFn })).toBe(true);
        expect(acquireLockFn).toHaveBeenCalledTimes(1);
    });

    it('dry=false, лок занят → false, передаёт отказ acquireLockFn (main() должен остановиться)', () => {
        const acquireLockFn = vi.fn(() => false);
        expect(acquireRunnerLock({ dry: false, acquireLockFn })).toBe(false);
        expect(acquireLockFn).toHaveBeenCalledTimes(1);
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

describe('listMonitorPids — все живые monitor.js сканом /proc, не по pid-файлу (#235)', () => {
    it('фильтрует нечисловые записи /proc и оставляет только monitor.js', () => {
        const readdirFn = () => ['1', '77', 'self', 'net', '200'];
        const isMonitorFn = (pid) => pid === 77 || pid === 200;
        expect(listMonitorPids({ readdirFn, isMonitorFn })).toEqual([77, 200]);
    });

    it('/proc не читается → пустой список, без исключения', () => {
        const readdirFn = () => {
            throw new Error('ENOENT');
        };
        expect(listMonitorPids({ readdirFn, isMonitorFn: () => true })).toEqual([]);
    });

    it('ни один pid не monitor.js → пустой список', () => {
        const readdirFn = () => ['1', '2', '3'];
        expect(listMonitorPids({ readdirFn, isMonitorFn: () => false })).toEqual([]);
    });
});

describe('processPpid — ppid процесса из /proc/<pid>/stat (#235)', () => {
    it('парсит ppid из штатного stat (comm простой)', () => {
        const readFn = () => '77 (node) S 1 77 77 0 -1 4194560 …';
        expect(processPpid(77, readFn)).toBe(1);
    });

    it('comm со скобками внутри не сдвигает индекс ppid (режем по ПОСЛЕДНЕЙ закрывающей скобке)', () => {
        const readFn = () => '77 (node (weird)) S 4242 77 77 0 -1 4194560 …';
        expect(processPpid(77, readFn)).toBe(4242);
    });

    it('/proc/<pid>/stat не читается → null, без исключения', () => {
        const readFn = () => {
            throw new Error('ENOENT');
        };
        expect(processPpid(999, readFn)).toBe(null);
    });
});

// #235-ревью: скан /proc (sweepOrphanMonitors) сверяет ПОЛНЫЙ путь MONITOR_PATH, не
// родовое имя 'monitor.js' — иначе чужой monitor.js (pm2, чужой проект) попал бы в
// уборку и был бы прибит SIGTERM'ом всей группе.

describe('isRalphMonitorProcess — строгая сверка по полному пути MONITOR_PATH (#235)', () => {
    it('cmdline с полным путём .claude/ralph/monitor.js → наш монитор', () => {
        const readFn = () => 'node\0.claude/ralph/monitor.js\0--profile\0prod\0';
        expect(isRalphMonitorProcess(99, readFn)).toBe(true);
    });

    it('чужой monitor.js по другому пути → НЕ наш (в отличие от нестрогой isMonitorProcess)', () => {
        const cmdline = () => 'node\0/opt/pm2/monitor.js\0';
        expect(isRalphMonitorProcess(99, cmdline)).toBe(false);
        // нестрогая по подстроке 'monitor.js' — как раз ошиблась бы, зацепив чужой
        expect(isMonitorProcess(99, cmdline)).toBe(true);
    });

    it('пустой/нулевой pid → false без чтения /proc', () => {
        const readFn = vi.fn();
        expect(isRalphMonitorProcess(0, readFn)).toBe(false);
        expect(readFn).not.toHaveBeenCalled();
    });
});

describe('sweepOrphanMonitors — уборка сирот-мониторов мимо monitor.pid (#235)', () => {
    it('две сироты + одна легитимная (тот же профиль) → остаётся одна, две глушим', () => {
        const stopFn = vi.fn();
        const writePidFn = vi.fn();
        const logFn = vi.fn();
        const got = sweepOrphanMonitors({
            profile: 'prod',
            logFn,
            listPidsFn: () => [100, 200, 300],
            ppidFn: () => 1, // все трое — настоящие сироты (родитель умер, init усыновил)
            readCmdlineFn: () => 'node\0.claude/ralph/monitor.js\0--profile\0prod\0',
            stopFn,
            writePidFn,
        });

        // #235-ревью: возврат ВСЕГДА null — подхват выбранного сироты делает adoptMonitor
        // штатным путём; sweep лишь пишет его в pid-файл.
        expect(got).toBe(null);
        expect(stopFn).toHaveBeenCalledTimes(2);
        expect(stopFn).toHaveBeenCalledWith({ pid: 200 }, expect.any(Object));
        expect(stopFn).toHaveBeenCalledWith({ pid: 300 }, expect.any(Object));
        expect(writePidFn).toHaveBeenCalledWith(100);
        expect(logFn).toHaveBeenCalledWith(expect.stringContaining('2'));
    });

    // #235-ревью: типовой сценарий issue — РОВНО одна сирота мимо pid-файла (pid 742406
    // ночью 23.07). Ничего не глушим, но обязаны записать её в pid-файл и вернуть null,
    // чтобы adoptMonitor подхватил её штатно (со своим логом), а не молча.
    it('ровно одна сирота (типовой случай) → пишем в pid-файл, null, без глушений', () => {
        const stopFn = vi.fn();
        const writePidFn = vi.fn();
        const got = sweepOrphanMonitors({
            profile: 'prod',
            listPidsFn: () => [742406],
            ppidFn: () => 1,
            readCmdlineFn: () => 'node\0.claude/ralph/monitor.js\0--profile\0prod\0',
            stopFn,
            writePidFn,
        });
        expect(got).toBe(null);
        expect(stopFn).not.toHaveBeenCalled();
        expect(writePidFn).toHaveBeenCalledWith(742406);
    });

    it('сирот нет → null, ничего не глушим и не пишем', () => {
        const stopFn = vi.fn();
        const writePidFn = vi.fn();
        expect(
            sweepOrphanMonitors({
                profile: 'prod',
                listPidsFn: () => [],
                ppidFn: () => 1,
                stopFn,
                writePidFn,
            }),
        ).toBe(null);
        expect(stopFn).not.toHaveBeenCalled();
        expect(writePidFn).not.toHaveBeenCalled();
    });

    // Штатная tmux-панель (RUNBOOK, окно 3) — тот же monitor.js, но с живым
    // родителем-shell (ppid≠1). Уборка её не трогает вовсе: не глушим, не считаем
    // кандидатом на «оставить».
    it('живой родитель (ppid≠1, tmux-панель) → не глушим и не подхватываем', () => {
        const stopFn = vi.fn();
        const writePidFn = vi.fn();
        const got = sweepOrphanMonitors({
            profile: 'prod',
            listPidsFn: () => [500],
            ppidFn: (pid) => (pid === 500 ? 4242 : 1), // родитель жив — не сирота
            readCmdlineFn: () => 'node\0.claude/ralph/monitor.js\0--profile\0prod\0',
            stopFn,
            writePidFn,
        });
        expect(got).toBe(null);
        expect(stopFn).not.toHaveBeenCalled();
        expect(writePidFn).not.toHaveBeenCalled();
    });

    it('ни одна сирота не в нужном профиле → глушим всех, не подхватываем ни одну', () => {
        const stopFn = vi.fn();
        const writePidFn = vi.fn();
        const logFn = vi.fn();
        const got = sweepOrphanMonitors({
            profile: 'prod',
            logFn,
            listPidsFn: () => [100, 200],
            ppidFn: () => 1,
            readCmdlineFn: () => 'node\0.claude/ralph/monitor.js\0--profile\0playground\0',
            stopFn,
            writePidFn,
        });
        expect(got).toBe(null);
        expect(stopFn).toHaveBeenCalledTimes(2);
        expect(writePidFn).not.toHaveBeenCalled();
    });

    it('profile не задан → сверки нет, оставляем первую сироту как есть', () => {
        const stopFn = vi.fn();
        const writePidFn = vi.fn();
        const got = sweepOrphanMonitors({
            listPidsFn: () => [100, 200],
            ppidFn: () => 1,
            readCmdlineFn: () => {
                throw new Error('не должен читаться без profile');
            },
            stopFn,
            writePidFn,
        });
        expect(got).toBe(null);
        expect(stopFn).toHaveBeenCalledTimes(1);
        expect(stopFn).toHaveBeenCalledWith({ pid: 200 }, expect.any(Object));
        expect(writePidFn).toHaveBeenCalledWith(100);
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
            // Общий рекордер для sh (строки) и argv-мутаций (#193): нормализуем argv в
            // ту же строковую форму, чтобы инвариант проверялся на ПОЛНОЙ хореографии
            // одним списком shCmds, а shImpl задавал поведение по строке команды.
            const record = (cmd) => {
                shCmds.push(cmd);
                if (shImpl) {
                    const r = shImpl(cmd);
                    if (r !== undefined) return r;
                }
                if (cmd.startsWith('git rev-parse --verify')) return SHA_HEAD; // локалка == PR
                return '';
            };
            const shFn = (cmd) => record(cmd);
            // git fetch/checkout и gh pr merge теперь идут argv-каналом (#193).
            const runArgvFn = (file, args) => record(`${file} ${args.join(' ')}`);
            const detachOriginMain = () =>
                runArgvFn('git', ['checkout', '--detach', 'origin/main']);
            const deps = {
                dry: false,
                shFn,
                runArgvFn,
                logFn: () => {},
                ensureCleanFn: () => true,
                findOpenPrFn: () => ({ number: 5, labels: [] }),
                // РЕАЛЬНЫЙ checksGreen, пишущий в тот же shCmds и видящий ту же PR-голову.
                checksGreenFn: (branch, prNumber) =>
                    checksGreen(branch, prNumber, {
                        shFn,
                        runArgvFn,
                        ghJsonFn: () => ({ headRefOid: SHA_HEAD }),
                        logFn: () => {},
                        parkFn: detachOriginMain,
                        syncDepsFn: () => {}, // не гоняем реальный npm ci в инвариант-тесте
                    }),
                phaseMergedFn: () => false,
                sleepFn: () => {},
                parkFn: detachOriginMain,
                getLastRedCheckFn: () => null,
            };
            return { shCmds, deps };
        };

        it('зелёный гейт целиком: merged, и ни одной запрещённой git-команды на всём пути', () => {
            const { shCmds, deps } = mkWiring();
            expect(tryMergePhase(phase, deps)).toBe('merged');

            // Позитив: раннер ходил строго детачем — на PR-голову и на origin/main.
            // #193: argv → значения не квотируются в шелл-строку.
            expect(shCmds).toContain('git fetch origin feature/m1');
            expect(shCmds).toContain(`git checkout --detach ${SHA_HEAD}`);
            expect(shCmds).toContain('git fetch origin main');
            expect(shCmds).toContain('git checkout --detach origin/main');
            // #SiaTz: мердж привязан к ТОЙ ЖЕ голове, что прогнал реальный checksGreen —
            // --match-head-commit закрывает TOCTOU-окно между чеками и мерджем.
            expect(shCmds).toContain(
                `gh pr merge 5 --squash --delete-branch --match-head-commit ${SHA_HEAD}`,
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
            expect(shCmds).not.toContain('gh pr merge 5 --squash --delete-branch');
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

    // #252: fetch — мутация через runArgvFn, diff --name-only остаётся на shFn.
    // Общий рекордер (см. mkCmdRecorders на уровне файла) нормализует runArgvFn в ту же
    // строку `cmds`, чтобы ассерты на порядок команд остались осмысленными.
    const mkRecorders = mkCmdRecorders;

    it('фетчит ДО диффа: решение не принимается по протухшим remote-ссылкам', () => {
        const { cmds, shFn, runArgvFn } = mkRecorders();
        phaseDiffFiles('feature/x', { shFn, runArgvFn, logFn: () => {} });
        expect(cmds[0]).toContain('git fetch origin main feature/x --quiet');
        expect(cmds[1]).toContain('diff --name-only');
        expect(cmds[1]).toContain('origin/main...origin/feature/x');
    });

    it('#252: fetch уходит раздельными элементами argv (branch не в шелл-строке)', () => {
        const argvCalls = [];
        phaseDiffFiles('feature/x', {
            shFn: () => '',
            runArgvFn: (file, args) => {
                argvCalls.push([file, args]);
                return '';
            },
            logFn: () => {},
        });
        expect(argvCalls).toContainEqual([
            'git',
            ['fetch', 'origin', 'main', 'feature/x', '--quiet'],
        ]);
    });

    it('дифф идёт с --no-renames: перенос файла ИЗ зоны риска виден', () => {
        // Без --no-renames git отдаёт только НОВЫЙ путь, и переезд
        // .github/workflows/deploy.yml → docs/old.yml прошёл бы мимо эскалации.
        const { cmds, shFn, runArgvFn } = mkRecorders();
        phaseDiffFiles('feature/x', { shFn, runArgvFn, logFn: () => {} });
        expect(cmds[1]).toContain('--no-renames');
    });

    it('падение fetch не роняет сдачу — null и предупреждение в лог', () => {
        const logs = [];
        const files = phaseDiffFiles('feature/x', {
            shFn: () => '',
            runArgvFn: () => {
                throw new Error('fatal: could not read from remote');
            },
            logFn: (m) => logs.push(m),
        });
        expect(files).toBe(null);
        expect(logs.join('\n')).toMatch(/дифф/i);
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

// #232: shq/positiveIntOrDefault/sleep вынесены в общий ralph-util.ts — единственный
// источник правды; их полные негативные наборы (в т.ч. anti-injection round-trip shq
// через живой /bin/sh) живут в ralph-util.test.ts. Здесь — только смоук ре-экспорта:
// ralph.js отдаёт ровно тот же объект, а не свою копию (иначе дубль снова разъедется).

describe('ре-экспорт утилит из ralph-util.ts (#232)', () => {
    const util = require('./ralph-util.ts');

    // sleep в module.exports ralph.js не выведен (используется только внутри), поэтому
    // сверяем экспортируемую пару — этого достаточно, чтобы поймать «завёл вторую копию».
    it('shq/positiveIntOrDefault — тот же объект, что в ralph-util.ts', () => {
        expect(ralph.shq).toBe(util.shq);
        expect(ralph.positiveIntOrDefault).toBe(util.positiveIntOrDefault);
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
            runArgvFn: () => '',
            logFn: () => {},
        });
        expect(cmds[0]).toContain('core.quotePath=false');
        // Без флага git отдал бы "src/payload/\320\272..." — мимо любого глоба.
        expect(matchRiskPaths(files, ['src/payload/**'])).toBe(
            'src/payload/коллекции/пользователи.ts',
        );
    });

    it('пустой дифф пишет предупреждение — это аномалия, а не «зоны не задеты»', () => {
        const logs = [];
        const files = phaseDiffFiles('feature/x', {
            shFn: () => '',
            runArgvFn: () => '',
            logFn: (m) => logs.push(m),
        });
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

describe('reviewDiffContext — дифф в промпт ревью (#133)', () => {
    const { reviewDiffContext } = ralph;

    // #252: fetch внутри phaseDiffFiles — теперь argv-мутация; noArgv — общий
    // «успешный» стаб, когда сценарий не проверяет саму фазу fetch.
    const noArgv = () => '';
    const shOk = (diffBody) => (cmd) => {
        if (cmd.includes('--name-only')) return 'src/a.ts\nsrc/b.ts';
        return diffBody;
    };

    it('подаёт список файлов и сам дифф', () => {
        const ctx = reviewDiffContext('feature/x', {
            shFn: shOk('diff --git a/src/a.ts b/src/a.ts\n+строка'),
            runArgvFn: noArgv,
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
            runArgvFn: noArgv,
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
            runArgvFn: noArgv,
            logFn: () => {},
            limit: 1000,
        });
        expect(ctx).not.toContain('ОБРЕЗАН');
    });

    it('сбой текста диффа не роняет ревью — остаётся список файлов и совет', () => {
        const ctx = reviewDiffContext('feature/x', {
            shFn: (cmd) => {
                if (cmd.includes('--name-only')) return 'src/a.ts';
                throw new Error('git diff умер');
            },
            runArgvFn: noArgv,
            logFn: () => {},
        });
        expect(ctx).toContain('- src/a.ts');
        expect(ctx).toContain('gh pr diff');
    });

    it('дифф недоступен целиком — пустая строка, промпт остаётся валидным', () => {
        const ctx = reviewDiffContext('feature/x', {
            shFn: () => '',
            runArgvFn: () => {
                throw new Error('нет remote');
            },
            logFn: () => {},
        });
        expect(ctx).toBe('');
    });

    it('имя ветки уходит в git заквотированным (диф-чтение) и argv-элементом (fetch)', () => {
        const cmds = [];
        const argvCalls = [];
        reviewDiffContext('feature/x', {
            shFn: (c) => {
                cmds.push(c);
                return c.includes('--name-only') ? 'src/a.ts' : 'дифф';
            },
            runArgvFn: (file, args) => {
                argvCalls.push([file, args]);
                return '';
            },
            logFn: () => {},
        });
        expect(cmds.some((c) => c.includes(`'origin/main...origin/feature/x'`))).toBe(true);
        expect(argvCalls).toContainEqual([
            'git',
            ['fetch', 'origin', 'main', 'feature/x', '--quiet'],
        ]);
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
                getLastGatePr: () => null,
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
            runArgvFn: () => '',
            logFn: () => {},
            limit: 10,
        });
        const body = ctx.split('=====')[2];
        expect(body).not.toMatch(/[\uD800-\uDBFF]$/);
        expect([...body].every((ch) => ch.codePointAt(0) !== 0xfffd)).toBe(true);
    });
});

// #199: синк доски после мерджа фазы. Скрипт (scripts/project-sync.mjs) fail-closed и
// краснеет на сомнительных данных — это его тесты. Здесь проверяется ровно обёртка:
// она обязана быть best-effort, потому что косметика доски не имеет права ронять уже
// смердженную фазу.
describe('closeMilestoneByTitle — закрытие milestone сразу после мерджа фазы (#252: argv)', () => {
    const { closeMilestoneByTitle } = ralph;

    it('находит открытый milestone по title и закрывает через argv', () => {
        const argvCalls = [];
        const logs = [];
        closeMilestoneByTitle('Фаза X', {
            ghJsonFn: () => [{ number: 7, title: 'Фаза X' }],
            runArgvFn: (file, args) => argvCalls.push([file, args]),
            logFn: (m) => logs.push(m),
        });
        expect(argvCalls).toContainEqual([
            'gh',
            ['api', '-X', 'PATCH', 'repos/{owner}/{repo}/milestones/7', '-f', 'state=closed'],
        ]);
        expect(logs.join('\n')).toMatch(/Milestone закрыт: "Фаза X"/);
    });

    it('milestone не найден среди открытых → не мутирует', () => {
        const runArgvFn = vi.fn();
        closeMilestoneByTitle('Фаза Y', {
            ghJsonFn: () => [{ number: 7, title: 'Фаза X' }],
            runArgvFn,
            logFn: () => {},
        });
        expect(runArgvFn).not.toHaveBeenCalled();
    });

    it('сбой чтения/мутации — fail-open, только лог', () => {
        const logs = [];
        expect(() =>
            closeMilestoneByTitle('Фаза X', {
                ghJsonFn: () => {
                    throw new Error('gh boom');
                },
                logFn: (m) => logs.push(m),
            }),
        ).not.toThrow();
        expect(logs.join('\n')).toMatch(/свип подберёт/);
    });
});

describe('closeCompletedMilestones — свип хвостов прошлых фаз (#252: argv)', () => {
    const { closeCompletedMilestones } = ralph;

    it('milestone с закрытыми issues и смерджённым PR фазы — закрывает через argv', () => {
        const argvCalls = [];
        const logs = [];
        closeCompletedMilestones({
            // Milestone выпал из config.phases (старая фаза) — совпадение по
            // заголовку PR "feat: <milestone>", как его создаёт сам раннер.
            cfg: { phases: [] },
            ghJsonFn: (cmd) =>
                cmd.includes('milestones')
                    ? [{ number: 9, title: 'Фаза X', open_issues: 0, closed_issues: 3 }]
                    : [{ title: 'feat: Фаза X', headRefName: 'feature/x' }],
            runArgvFn: (file, args) => argvCalls.push([file, args]),
            logFn: (m) => logs.push(m),
        });
        expect(argvCalls).toContainEqual([
            'gh',
            ['api', '-X', 'PATCH', 'repos/{owner}/{repo}/milestones/9', '-f', 'state=closed'],
        ]);
        expect(logs.join('\n')).toMatch(/Milestone закрыт: "Фаза X"/);
    });

    it('milestone с открытыми issues — пропускается, без мутации', () => {
        const runArgvFn = vi.fn();
        closeCompletedMilestones({
            ghJsonFn: (cmd) =>
                cmd.includes('milestones')
                    ? [{ number: 9, title: 'Фаза X', open_issues: 2, closed_issues: 1 }]
                    : [],
            runArgvFn,
            logFn: () => {},
        });
        expect(runArgvFn).not.toHaveBeenCalled();
    });

    it('нет смерджённого PR фазы — пропускается, без мутации', () => {
        const runArgvFn = vi.fn();
        closeCompletedMilestones({
            cfg: { phases: [] },
            ghJsonFn: (cmd) =>
                cmd.includes('milestones')
                    ? [{ number: 9, title: 'Фаза X', open_issues: 0, closed_issues: 3 }]
                    : [],
            runArgvFn,
            logFn: () => {},
        });
        expect(runArgvFn).not.toHaveBeenCalled();
    });

    it('сбой чтения данных для свипа — fail-open, только лог', () => {
        const logs = [];
        expect(() =>
            closeCompletedMilestones({
                ghJsonFn: () => {
                    throw new Error('gh boom');
                },
                logFn: (m) => logs.push(m),
            }),
        ).not.toThrow();
        expect(logs.join('\n')).toMatch(/свипа milestones/);
    });
});

describe('syncProjectBoard', () => {
    // #252: мутация — через argv (runArgvFn), не строкой через шелл.
    it('зовёт скрипт синка через argv и логирует последнюю строку его вывода', () => {
        const argvCalls = [];
        const logs = [];
        ralph.syncProjectBoard(
            (file, args) => {
                argvCalls.push([file, args]);
                return 'шум\n✅ project-sync: доска в порядке\n';
            },
            (m) => logs.push(m),
        );
        expect(argvCalls).toEqual([['node', ['scripts/project-sync.mjs']]]);
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

// ── Контракт «оркестратор + тонкий entry» (#365) ──────────────────────────────────────
// Барьер от регрессии распила: вся логика петли живёт в orchestrator.ts (фабрика
// createOrchestrator, собирающая остальные модули), а ralph.js — только entry (проверка
// Node, парсинг CLI-флагов, запуск main(), ре-экспорт API). «Тонкость» entry и полнота
// API проверяются детерминированно, а не на слово (принцип «барьеры важнее промптов»).
// Здесь же зовём createOrchestrator НАПРЯМУЮ (не через ralph.js) — так проверяется сама
// сборка фабрики, а не только то, что она долетает до готового ralph.js.

import path from 'node:path';
import { createOrchestrator } from './orchestrator.ts';

// process.cwd(): vitest гоняет тесты из корня репо — путь стабилен.
const RALPH_JS = path.join(process.cwd(), '.claude', 'ralph', 'ralph.js');

// Боевые флаги по умолчанию — как у vitest-процесса без CLI-флагов раннера.
const FLAGS_OFF = {
    once: false,
    dry: false,
    reset: false,
    resubmit: false,
    deployResolved: false,
};

// Минимальные внешние JS-коллабораторы (мост из entry): фейки вместо
// telegram-notifier/gate-env, чтобы сборка фабрики не тянула сеть/env.
function buildRuntime(flags = FLAGS_OFF, argv = []) {
    return createOrchestrator({
        argv,
        flags,
        external: {
            sendTelegramMessage: () => false,
            telegramConfigFromEnv: () => ({ token: '', chatId: '' }),
            buildSanitizedGateEnv: () => ({}),
        },
    });
}

describe('createOrchestrator: API-поверхность', () => {
    // Поверхность module.exports ralph.js — контракт: на ней сидят тесты выше в этом
    // файле, модульные тест-файлы и monitor.js (resolveProfile/parseProfileFlag/
    // pushEvent/shq). Пропавший ключ = молча сломанный тест или монитор.
    const REQUIRED_API = [
        // config-слой
        'resolveProfile',
        'deepMerge',
        'parseProfileFlag',
        // монитор
        'startMonitor',
        'stopMonitor',
        'adoptMonitor',
        'processAlive',
        'cmdlineIncludes',
        'isMonitorProcess',
        'isRalphMonitorProcess',
        'listMonitorPids',
        'processPpid',
        'sweepOrphanMonitors',
        'ensureMonitorAlive',
        // lock/state
        'isRalphProcess',
        'lockAlive',
        'writeLock',
        'removeLock',
        'releaseLockIfOurs',
        'acquireLock',
        'acquireRunnerLock',
        'loadState',
        'lockHash',
        'syncDepsIfLockChanged',
        // claude-сессия
        'buildClaudeArgs',
        'spawnClaude',
        'runClaude',
        // примитивы исполнения (#138)
        'shq',
        'sh',
        'shArgv',
        'log',
        'sideEffectAttempts',
        // milestones/доска
        'closeCompletedMilestones',
        'closeMilestoneByTitle',
        'syncProjectBoard',
        // ревью
        'recordReviewFindings',
        'pickReviewModel',
        'pickReviewFallbackModel',
        'reviewModelRank',
        'strongerReviewModel',
        'removeBlockedLabel',
        'addBlockedLabel',
        'phaseDiffFiles',
        'reviewDiffContext',
        'globToRegExp',
        'matchRiskPaths',
        'sliceWholeChars',
        'formatExcerpt',
        // api-limit
        'parseResetWaitMs',
        'apiLimitWaitMs',
        'apiLimitMessage',
        'minutesOrDefault',
        'positiveIntOrDefault',
        'API_LIMIT_RE',
        // туннель/пуши
        'tunnelHealthy',
        'ensureTunnel',
        'tunnelCheckEnabled',
        'pushEvent',
        'probeEgress',
        'restartTunnel',
        // worktree
        'resolveWorktreePath',
        'parseWorktreeList',
        'refreshRunnerWorktree',
        'runnerWorktreeReady',
        'ensureRunnerWorktree',
        // петля/гейт
        'preflight',
        'runLoop',
        'ensureClean',
        'parkOnOriginMain',
        'safeBranch',
        'gateChecksFor',
        'checksGreen',
        'findOpenPr',
        'tryMergePhase',
        'getLastRedCheck',
        'getVerifiedHead',
        'getLastGatePr',
        // деплой-проверка
        'deployPhasePlaceholder',
        'mergedShaOf',
        'deployWaitMessage',
        'waitForDeployRun',
        'probeHttpStatus',
        'checkProdHealth',
        'isWorkflowGreen',
        'classifyDeployOutcome',
        // entry-запуск
        'main',
    ];

    it('возвращает все ключи прежнего module.exports ralph.js (плюс main)', () => {
        const runtime = buildRuntime();
        const missing = REQUIRED_API.filter((key) => runtime[key] === undefined);
        expect(missing).toEqual([]);
    });

    it('сборка фабрики — чистая: не запускает петлю и не трогает процесс', () => {
        // Если бы сборка дёргала git/gh/claude, боевые дефолты упали бы guardSideEffect
        // (RALPH_NO_SIDE_EFFECTS=1) — общий afterEach сверяет журнал. Здесь достаточно,
        // что фабрика собралась и вернула функции, не бросив.
        const runtime = buildRuntime();
        expect(typeof runtime.main).toBe('function');
        expect(typeof runtime.runLoop).toBe('function');
    });

    it('ре-экспорт ralph.js отдаёт тот же контракт (import не запускает main)', async () => {
        // import сам по себе — проверка «main не запущен»: запуск main() из тестового
        // процесса упал бы на guardSideEffect/acquireLock или ушёл в process.exit.
        const ralphModule = await import('./ralph.js');
        const missing = REQUIRED_API.filter((key) => ralphModule.default[key] === undefined);
        expect(missing).toEqual([]);
    });
});

// #369 (фаза 5): ядро зависит от набора швов adapters.ts, собранного из текущих реализаций
// и выбираемого конфигом. Проверяем, что фабрика отдаёт полный набор (дефолтная сборка, до
// main()) и что сборка/резолв доступны на API-поверхности (для контрактного сьюта #370).
describe('createOrchestrator: набор швов адаптеров (#369)', () => {
    it('getAdapters отдаёт все пять швов сразу после сборки фабрики (дефолтный выбор)', () => {
        const runtime = buildRuntime();
        const adapters = runtime.getAdapters();
        expect(Object.keys(adapters).sort()).toEqual(
            ['coderRuntime', 'deployCheck', 'gate', 'notifier', 'taskSource'].sort(),
        );
        // Методы швов — функции (текущие реализации разложены по интерфейсам).
        expect(typeof adapters.taskSource.listReadyIssues).toBe('function');
        expect(typeof adapters.taskSource.mergePullRequest).toBe('function');
        expect(typeof adapters.gate.runChecks).toBe('function');
        expect(typeof adapters.notifier.notify).toBe('function');
        expect(typeof adapters.deployCheck.classifyOutcome).toBe('function');
        expect(typeof adapters.coderRuntime.run).toBe('function');
    });

    it('deployCheck.classifyOutcome — та же чистая классификация (GREEN только зелёный+здоровый)', () => {
        const { deployCheck } = buildRuntime().getAdapters();
        const green = {
            status: 'completed',
            conclusion: 'success',
            sha: 'b'.repeat(40),
            url: null,
            runId: 1,
        };
        expect(deployCheck.classifyOutcome(green, { ok: true, status: 200, url: 'u' }).red).toBe(
            false,
        );
        expect(deployCheck.classifyOutcome(green, { ok: false, status: 502, url: 'u' }).red).toBe(
            true,
        );
    });

    it('buildAdapters/resolveAdapterSelection на API-поверхности; неизвестная реализация → fail', () => {
        const runtime = buildRuntime();
        expect(typeof runtime.buildAdapters).toBe('function');
        expect(typeof runtime.resolveAdapterSelection).toBe('function');
        // resolveAdapterSelection fail-closed на неизвестном шве.
        expect(() =>
            runtime.resolveAdapterSelection({ nope: 'x' }, (m) => {
                throw new Error(m);
            }),
        ).toThrow();
    });
});

describe('createOrchestrator: флаги CLI', () => {
    it('dry: acquireRunnerLock не берёт лок вовсе (C1 read-only)', () => {
        const runtime = buildRuntime({ ...FLAGS_OFF, dry: true });
        let called = 0;
        // acquireLockFn не должен быть вызван: dry-прогон лок не проверяет и не пишет.
        const ok = runtime.acquireRunnerLock({
            acquireLockFn: () => {
                called++;
                return true;
            },
        });
        expect(ok).toBe(true);
        expect(called).toBe(0);
    });

    it('без dry: acquireRunnerLock зовёт acquireLock', () => {
        const runtime = buildRuntime();
        let called = 0;
        runtime.acquireRunnerLock({
            acquireLockFn: () => {
                called++;
                return true;
            },
        });
        expect(called).toBe(1);
    });

    // #252/C1 (ревью #365): сам git fetch — мутация remote-ссылок, а --dry-run строго
    // read-only. Живой --dry-run доходит до phaseDiffFiles (выбор ревью-модели), поэтому
    // фетч в нём пропускается; дифф всё же считается по имеющимся origin-ссылкам.
    it('dry: phaseDiffFiles не делает git fetch (C1 read-only)', () => {
        const runtime = buildRuntime({ ...FLAGS_OFF, dry: true });
        const runArgv = vi.fn(() => '');
        const shFn = vi.fn(() => '');
        runtime.phaseDiffFiles('feature/x', { runArgvFn: runArgv, shFn, logFn: () => {} });
        expect(runArgv).not.toHaveBeenCalled();
        expect(shFn).toHaveBeenCalled(); // дифф считается, фетч — нет
    });

    it('без dry: phaseDiffFiles фетчит перед диффом (свежие ссылки)', () => {
        const runtime = buildRuntime({ ...FLAGS_OFF, dry: false });
        const runArgv = vi.fn(() => '');
        runtime.phaseDiffFiles('feature/x', {
            runArgvFn: runArgv,
            shFn: () => '',
            logFn: () => {},
        });
        expect(runArgv).toHaveBeenCalledWith('git', [
            'fetch',
            'origin',
            'main',
            'feature/x',
            '--quiet',
        ]);
    });
});

describe('ralph.js: тонкий entry (храповик распила #365)', () => {
    const source = fs.readFileSync(RALPH_JS, 'utf-8');

    it('entry короче 200 строк — монолит не возвращается', () => {
        // До распила ralph.js держал 2990 строк. Порог с запасом на комментарии:
        // рост выше — признак, что логика снова оседает в entry, а не в модулях.
        expect(source.split('\n').length).toBeLessThan(200);
    });

    it('в entry нет петли и гейта — только парсинг флагов и запуск', () => {
        // Маркеры монолитной логики, которых в тонком entry быть не должно.
        expect(source).not.toMatch(/while \(true\)/);
        expect(source).not.toMatch(/execSync|spawnSync\(/);
        expect(source).not.toMatch(/tryMergePhase|checksGreen|runLoop\s*\(/);
    });

    it('entry парсит все пять флагов режима и --profile', () => {
        for (const flag of ['--once', '--dry-run', '--reset', '--resubmit', '--deploy-resolved']) {
            expect(source).toContain(`'${flag}'`);
        }
        // --profile парсится в main() оркестратора из argv, entry обязан его передать.
        expect(source).toMatch(/argv/);
    });

    // Ревью #365: неизвестный флаг иначе молча игнорировался бы — опечатка (`--dryrun`,
    // кириллическая «у» в `--dry-run`) превратила бы намеренный read-only/HITL-запуск в
    // живой AFK-прогон. Allowlist срабатывает ДО main() (лок не берётся) — spawn безопасен.
    it('неизвестный флаг → entry падает с ненулевым кодом ДО старта петли', () => {
        const { spawnSync } = require('node:child_process');
        const res = spawnSync('node', [RALPH_JS, '--dryrun'], {
            encoding: 'utf-8',
            timeout: 15000,
        });
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(/Неизвестный флаг "--dryrun"/);
    });
});
