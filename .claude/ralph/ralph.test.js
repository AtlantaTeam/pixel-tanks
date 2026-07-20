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

const { buildClaudeArgs, formatExcerpt, parseResetWaitMs, API_LIMIT_RE, spawnClaude } = ralph;

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
