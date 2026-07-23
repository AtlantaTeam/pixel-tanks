import { describe, expect, it, vi } from 'vitest';
import {
    collectAdvisories,
    fetchOriginMain,
    gitBaseBaseline,
    gitChangedFiles,
    countBySeverity,
    diffBaseline,
    loadBaseline,
    loadPushedKeys,
    looksBlind,
    pushAcceptedBaselineChanges,
    runAudit,
    savePushedKeys,
    sideEffectAttempts,
} from './security-audit.mjs';

// #83/#140: детерминированный security-скан прод-гейта. Числовой порог (#83) заменён
// сверкой со списком известных advisory-id: PR, добавляющий одну новую high, порога
// не превышал и проходил молча, а после починки апстримом находки могли тихо отрасти
// обратно до порога. Теперь красный — это «появился id вне baseline», сколько бы их
// ни было всего.

// Форма реального отчёта npm: корневое advisory лежит в via ОБЪЕКТОМ, а строкой в via
// записан лишь пакет-переносчик. Одна дыра undici приезжает и через payload, и через
// @payloadcms/next — в отчёте это разные записи vulnerabilities с одним source-id.
const auditWith = (vulnerabilities) => ({
    metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0 } },
    vulnerabilities,
});

describe('collectAdvisories', () => {
    it('берёт critical/high и игнорирует moderate/low — шум не должен красить гейт', () => {
        const json = auditWith({
            undici: {
                severity: 'high',
                via: [
                    { source: 1, severity: 'high', name: 'undici', title: 'дыра', url: 'u1' },
                    { source: 2, severity: 'moderate', name: 'undici', title: 'шум', url: 'u2' },
                    { source: 3, severity: 'low', name: 'undici', title: 'шум', url: 'u3' },
                ],
            },
        });
        expect(collectAdvisories(json).map((a) => a.id)).toEqual([1]);
    });

    it('critical попадает в гейтимые наравне с high', () => {
        const json = auditWith({
            pkg: { severity: 'critical', via: [{ source: 9, severity: 'critical', title: 'ой' }] },
        });
        expect(collectAdvisories(json).map((a) => a.id)).toEqual([9]);
    });

    it('одна дыра через нескольких переносчиков — одна запись, а не пять', () => {
        const via = { source: 42, severity: 'high', name: 'undici', title: 'дыра', url: 'u' };
        const json = auditWith({
            undici: { severity: 'high', via: [via] },
            payload: { severity: 'high', via: [via, 'undici'] },
            '@payloadcms/next': { severity: 'high', via: [via, 'payload'] },
        });
        expect(collectAdvisories(json)).toHaveLength(1);
        expect(collectAdvisories(json)[0].id).toBe(42);
    });

    it('#239: захватывает fixAvailable из отчёта npm (объектная форма — фикс с версией)', () => {
        const json = auditWith({
            immutable: {
                severity: 'high',
                fixAvailable: { name: 'immutable', version: '5.1.3', isSemVerMajor: false },
                via: [{ source: 1124008, severity: 'high', name: 'immutable', title: 'дыра' }],
            },
        });
        expect(collectAdvisories(json)[0].fixAvailable).toEqual({
            name: 'immutable',
            version: '5.1.3',
            isSemVerMajor: false,
        });
    });

    it('#239: fixAvailable:false (апстрим ещё не починил) — сохраняется как есть', () => {
        const json = auditWith({
            sharp: {
                severity: 'high',
                fixAvailable: false,
                via: [{ source: 1124066, severity: 'high', name: 'sharp', title: 'дыра' }],
            },
        });
        expect(collectAdvisories(json)[0].fixAvailable).toBe(false);
    });

    it('#239: fixAvailable отсутствует в отчёте — дефолт false, не молчаливый undefined', () => {
        const json = auditWith({
            pkg: { severity: 'high', via: [{ source: 1, severity: 'high', title: 'x' }] },
        });
        expect(collectAdvisories(json)[0].fixAvailable).toBe(false);
    });

    it('строки в via (пакеты-переносчики) не считаются находками', () => {
        const json = auditWith({ payload: { severity: 'high', via: ['undici', 'uuid'] } });
        expect(collectAdvisories(json)).toEqual([]);
    });

    it('гейтимая находка без source-id — исключение, а не молчаливый пропуск', () => {
        // Сопоставить с baseline такую запись нечем; пропустить её молча — ровно та
        // дыра, ради которой baseline и заводился.
        const json = auditWith({
            pkg: { severity: 'high', via: [{ severity: 'high', title: 'без id' }] },
        });
        expect(() => collectAdvisories(json)).toThrow(/без source-id/);
    });

    it('неизвестная severity — исключение: формат отчёта изменился, сверке верить нельзя', () => {
        // Молча отбросить такую запись = выронить находку и остаться зелёным
        // (ревью PR #141): это fail-open в скрипте, от которого зависит автомердж.
        const json = auditWith({
            pkg: {
                severity: 'high',
                via: [{ source: 1, severity: 'severe', title: 'новый уровень' }],
            },
        });
        expect(() => collectAdvisories(json)).toThrow(/неизвестной severity/);
    });

    it('пустой отчёт — пустой список, без падения', () => {
        expect(collectAdvisories({})).toEqual([]);
        expect(collectAdvisories({ vulnerabilities: {} })).toEqual([]);
    });
});

describe('diffBaseline', () => {
    const baseline = [{ id: 1 }, { id: 2 }];

    it('находка вне baseline — fresh (красит гейт)', () => {
        const { fresh } = diffBaseline([{ id: 3 }], baseline);
        expect(fresh.map((f) => f.id)).toEqual([3]);
    });

    it('все находки в baseline — fresh пуст (гейт зелёный)', () => {
        expect(diffBaseline([{ id: 1 }, { id: 2 }], baseline).fresh).toEqual([]);
    });

    it('запись baseline без находки — stale (апстрим починил, пора удалить)', () => {
        const { stale, fresh } = diffBaseline([{ id: 1 }], baseline);
        expect(stale.map((s) => s.id)).toEqual([2]);
        // Протухшая запись не красит гейт: прод стал безопаснее, ронять на этом абсурдно.
        expect(fresh).toEqual([]);
    });

    it('severity выросла у известного id — changed (обоснование в baseline устарело)', () => {
        // Запись принималась как high с обоснованием «SOCKS5 в проде не используем».
        // Переоценка в critical это обоснование обнуляет, а сверка по одному id
        // проглотила бы её молча.
        const { changed, fresh } = diffBaseline(
            [{ id: 1, severity: 'critical' }],
            [{ id: 1, severity: 'high' }],
        );
        expect(changed.map((c) => c.id)).toEqual([1]);
        expect(fresh).toEqual([]);
    });

    it('severity та же — не changed', () => {
        expect(
            diffBaseline([{ id: 1, severity: 'high' }], [{ id: 1, severity: 'high' }]).changed,
        ).toEqual([]);
    });

    it('severity УПАЛА — не changed: апстрим переоценил в меньшую сторону, это не регресс', () => {
        expect(
            diffBaseline([{ id: 1, severity: 'high' }], [{ id: 1, severity: 'critical' }]).changed,
        ).toEqual([]);
    });

    it('пустой baseline: любая гейтимая находка — fresh', () => {
        expect(diffBaseline([{ id: 7 }], []).fresh.map((f) => f.id)).toEqual([7]);
    });
});

describe('looksBlind — ослепший сканер не должен быть зелёным', () => {
    it('ноль находок при непустом baseline — красный: это не «починили всё», а «скан не работает»', () => {
        // Зеркало/прокси registry, отдающее пустой advisory-фид, для npm выглядит как
        // «0 vulnerabilities». Единственный найденный ревью реалистичный путь к
        // ложно-зелёному гейту, поэтому fail-closed.
        expect(looksBlind([], [{ id: 1 }])).toBe(true);
    });

    it('находки есть — не ослеп', () => {
        expect(looksBlind([{ id: 1 }], [{ id: 1 }])).toBe(false);
    });

    it('пустой baseline и ноль находок — законно зелёно: сверять нечего и не с чем', () => {
        expect(looksBlind([], [])).toBe(false);
    });
});

describe('loadBaseline', () => {
    it('читает массив advisories из файла', () => {
        const readFn = () => JSON.stringify({ advisories: [{ id: 1 }] });
        expect(loadBaseline(readFn, 'любой')).toEqual([{ id: 1 }]);
    });

    it('бросает на файле без advisories — не молчит на неожиданный формат', () => {
        expect(() => loadBaseline(() => '{}', 'x')).toThrow(/advisories/);
        expect(() => loadBaseline(() => '{"advisories":{}}', 'x')).toThrow(/advisories/);
    });

    it('боевой baseline читается и все записи опознаваемы', () => {
        // Опечатка в id или потерянный reason превращают запись в вечное молчаливое
        // разрешение — сверяем форму на настоящем файле, а не на фикстуре.
        const real = loadBaseline();
        expect(real.length).toBeGreaterThan(0);
        for (const entry of real) {
            expect(typeof entry.id).toBe('number');
            expect(entry.reason?.length ?? 0).toBeGreaterThan(0);
            expect(['critical', 'high']).toContain(entry.severity);
        }
    });
});

describe('countBySeverity', () => {
    it('читает counts из metadata.vulnerabilities npm audit --json', () => {
        const auditJson = {
            metadata: { vulnerabilities: { critical: 1, high: 2, moderate: 3, low: 4 } },
        };
        expect(countBySeverity(auditJson)).toEqual({ critical: 1, high: 2, moderate: 3, low: 4 });
    });

    it('отсутствующая severity в отчёте = 0, а не undefined', () => {
        const auditJson = { metadata: { vulnerabilities: { high: 5 } } };
        expect(countBySeverity(auditJson)).toEqual({ critical: 0, high: 5, moderate: 0, low: 0 });
    });

    it('бросает на отчёте без metadata.vulnerabilities — не молчит на неожиданный формат', () => {
        expect(() => countBySeverity({})).toThrow();
        expect(() => countBySeverity({ metadata: {} })).toThrow();
    });
});

describe('runAudit', () => {
    it('парсит JSON из stdout и гейтит ПРОД-поверхность (--omit=dev)', () => {
        const spawnFn = vi.fn(() => ({
            stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 1 } } }),
            status: 1,
        }));
        expect(runAudit(spawnFn)).toEqual({ metadata: { vulnerabilities: { high: 1 } } });
        // --omit=dev — часть решения #140: advisories dev-тулчейна (vite/vitest) на
        // сервер не уезжают и гейт красить не должны.
        expect(spawnFn).toHaveBeenCalledWith(
            'npm',
            ['audit', '--json', '--omit=dev'],
            expect.objectContaining({ encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }),
        );
    });

    it('бросает, если npm audit не вернул stdout (сеть недоступна и т.п.) — fail-closed', () => {
        const spawnFn = vi.fn(() => ({ stdout: '', status: null, error: new Error('ENOENT') }));
        expect(() => runAudit(spawnFn)).toThrow();
    });
});

// #207: базовые факты для политики baseline берутся из git — их агент подделать не может.
describe('gitChangedFiles / gitBaseBaseline', () => {
    it('возвращает список изменённых файлов относительно origin/main', () => {
        const spawnFn = vi
            .fn()
            .mockReturnValueOnce({ status: 0, stdout: 'package.json\nsrc/a.ts\n' })
            .mockReturnValueOnce({ status: 0, stdout: '' });
        expect(gitChangedFiles(spawnFn)).toEqual(['package.json', 'src/a.ts']);
        expect(spawnFn.mock.calls[0][1]).toEqual([
            'diff',
            '--name-only',
            '--no-renames',
            'origin/main...HEAD',
        ]);
    });

    it('видит незакоммиченные правки — иначе локальный прогон даёт ложный зелёный', () => {
        const spawnFn = vi
            .fn()
            .mockReturnValueOnce({ status: 0, stdout: 'src/a.ts\n' })
            .mockReturnValueOnce({ status: 0, stdout: ' M package.json\n?? new.txt\n' });
        expect(gitChangedFiles(spawnFn)).toEqual(['src/a.ts', 'package.json', 'new.txt']);
    });

    it('бросает, когда git недоступен — политику молча не пропускаем', () => {
        const spawnFn = vi.fn().mockReturnValue({ status: 128, stdout: '', stderr: 'not a repo' });
        expect(() => gitChangedFiles(spawnFn)).toThrow(/not a repo/);
    });

    it('пустой дифф и чистое дерево — пустой список, не ошибка', () => {
        const spawnFn = vi.fn().mockReturnValue({ status: 0, stdout: '' });
        expect(gitChangedFiles(spawnFn)).toEqual([]);
    });

    it('читает базовую версию baseline из origin/main', () => {
        const spawnFn = vi
            .fn()
            .mockReturnValue({ status: 0, stdout: JSON.stringify({ advisories: [{ id: 1 }] }) });
        expect(gitBaseBaseline(spawnFn)).toEqual([{ id: 1 }]);
    });

    it('отсутствие файла в origin/main — пустой базовый набор (первое появление baseline)', () => {
        const spawnFn = vi.fn().mockReturnValue({
            status: 128,
            stdout: '',
            stderr: "path 'scripts/x.json' does not exist in 'origin/main'",
        });
        expect(gitBaseBaseline(spawnFn)).toEqual([]);
    });

    it('прочая git-ошибка — стоп, а не «база пустая» (иначе автопринятие на мусоре)', () => {
        const spawnFn = vi
            .fn()
            .mockReturnValue({ status: 128, stdout: '', stderr: 'fatal: bad object' });
        expect(() => gitBaseBaseline(spawnFn)).toThrow(/не смог прочитать базовую версию/);
    });

    it('fetchOriginMain освежает ref и падает при сбое — сравнивать со старой базой нельзя', () => {
        const ok = vi.fn().mockReturnValue({ status: 0, stdout: '' });
        expect(() => fetchOriginMain(ok)).not.toThrow();
        expect(ok.mock.calls[0][1]).toEqual(['fetch', 'origin', 'main', '--quiet']);
        const bad = vi.fn().mockReturnValue({ status: 1, stdout: '', stderr: 'no network' });
        expect(() => fetchOriginMain(bad)).toThrow(/no network/);
    });

    it('битый baseline в origin/main — стоп, а не «сверим как есть»', () => {
        const spawnFn = vi.fn().mockReturnValue({ status: 0, stdout: '{"advisories":"нет"}' });
        expect(() => gitBaseBaseline(spawnFn)).toThrow(/без массива advisories/);
    });
});

// #239: хранилище ключей уже отправленных пушей — вне git (как ralph.state.json),
// живёт между прогонами гейта, для которых сама автозапись baseline не коммитится.
describe('loadPushedKeys / savePushedKeys', () => {
    it('файла ещё нет (ENOENT) — пустой список, не ошибка', () => {
        const readFn = () => {
            const e = new Error('no such file');
            e.code = 'ENOENT';
            throw e;
        };
        expect(loadPushedKeys(readFn)).toEqual([]);
    });

    it('читает существующий список ключей', () => {
        const readFn = () => JSON.stringify(['1:high', '2:critical']);
        expect(loadPushedKeys(readFn)).toEqual(['1:high', '2:critical']);
    });

    it('битый формат (не массив) — исключение, fail-closed', () => {
        const readFn = () => JSON.stringify({ oops: true });
        expect(() => loadPushedKeys(readFn)).toThrow(/без массива/);
    });

    it('прочая ошибка чтения — пробрасывается, не глотается как ENOENT', () => {
        const readFn = () => {
            throw new Error('EACCES');
        };
        expect(() => loadPushedKeys(readFn)).toThrow(/EACCES/);
    });

    it('боевой дефолт записи — предохранитель #138, а не тихая запись на диск в тестах', () => {
        expect(() => savePushedKeys(['1:high'])).toThrow(/побочка в тестовом окружении/);
        // Вызван НАМЕРЕННО — журнал забираем сами (как sh() в ralph.test.js #138),
        // иначе общий afterEach уронил бы этот же тест.
        expect(sideEffectAttempts.splice(0)).toEqual([expect.stringContaining('savePushedKeys(')]);
    });

    it('запись с инжектированным writeFn — без побочки, сериализует ключи', () => {
        const writeFn = vi.fn();
        savePushedKeys(['1:high'], writeFn);
        expect(writeFn).toHaveBeenCalledWith(
            expect.any(String),
            JSON.stringify(['1:high'], null, 2),
        );
    });
});

// #239: живой инцидент 22→23.07 — один и тот же апстрим-дрейф пушился на каждый
// прогон гейта, потому что автозапись baseline не коммитится до мерджа фазы, и
// каждый следующий прогон видел «те же новые записи» как будто впервые.
describe('pushAcceptedBaselineChanges — дедуп пуша (#239)', () => {
    it('пустой accepted — ничего не грузит и не шлёт', () => {
        const loadPushedKeysFn = vi.fn();
        const sendFn = vi.fn();
        pushAcceptedBaselineChanges([], { loadPushedKeysFn, sendFn });
        expect(loadPushedKeysFn).not.toHaveBeenCalled();
        expect(sendFn).not.toHaveBeenCalled();
    });

    it('новая advisory — шлёт пуш и запоминает ключ ПОСЛЕ успешной доставки', () => {
        const loadPushedKeysFn = vi.fn(() => []);
        const savePushedKeysFn = vi.fn();
        const sendFn = vi.fn(() => true);
        const accepted = [
            { id: 1, severity: 'high', package: 'immutable', expiresAt: '2026-08-05' },
        ];
        pushAcceptedBaselineChanges(accepted, {
            loadPushedKeysFn,
            savePushedKeysFn,
            sendFn,
            logFn: vi.fn(),
        });
        expect(sendFn).toHaveBeenCalledTimes(1);
        expect(savePushedKeysFn).toHaveBeenCalledWith(['1:high']);
    });

    it('та же advisory уже была запушена — повторный пуш не шлётся', () => {
        const loadPushedKeysFn = vi.fn(() => ['1:high']);
        const savePushedKeysFn = vi.fn();
        const sendFn = vi.fn(() => true);
        const accepted = [
            { id: 1, severity: 'high', package: 'immutable', expiresAt: '2026-08-05' },
        ];
        pushAcceptedBaselineChanges(accepted, {
            loadPushedKeysFn,
            savePushedKeysFn,
            sendFn,
            logFn: vi.fn(),
        });
        expect(sendFn).not.toHaveBeenCalled();
        expect(savePushedKeysFn).not.toHaveBeenCalled();
    });

    it('смешанный набор — шлёт только новые записи, но запоминает все принятые ключи', () => {
        const loadPushedKeysFn = vi.fn(() => ['1:high']);
        const savePushedKeysFn = vi.fn();
        const sendFn = vi.fn(() => true);
        const accepted = [
            { id: 1, severity: 'high', package: 'immutable', expiresAt: '2026-08-05' },
            { id: 2, severity: 'high', package: 'fast-uri', expiresAt: '2026-08-05' },
        ];
        pushAcceptedBaselineChanges(accepted, {
            loadPushedKeysFn,
            savePushedKeysFn,
            sendFn,
            logFn: vi.fn(),
        });
        expect(sendFn).toHaveBeenCalledTimes(1);
        expect(sendFn.mock.calls[0][0]).toMatch(/fast-uri/);
        expect(sendFn.mock.calls[0][0]).not.toMatch(/immutable/);
        expect(savePushedKeysFn).toHaveBeenCalledWith(['1:high', '2:high']);
    });

    it('доставка не удалась — ключ НЕ запоминается, следующий прогон вправе повторить попытку', () => {
        const loadPushedKeysFn = vi.fn(() => []);
        const savePushedKeysFn = vi.fn();
        const sendFn = vi.fn(() => false);
        const logFn = vi.fn();
        const accepted = [
            { id: 1, severity: 'high', package: 'immutable', expiresAt: '2026-08-05' },
        ];
        pushAcceptedBaselineChanges(accepted, {
            loadPushedKeysFn,
            savePushedKeysFn,
            sendFn,
            logFn,
        });
        expect(savePushedKeysFn).not.toHaveBeenCalled();
        expect(logFn.mock.calls.some(([msg]) => /НЕ доставлен/.test(msg))).toBe(true);
    });

    // #239-ревью (🟠): дедуп-стор — косметика (инв. 1), его поломка не должна краснить
    // гейт, когда verdict.ok уже true. Битый/нечитаемый стор → warn + деградация в
    // «пушим всё», а не необработанный throw и ложно-красный гейт.
    it('битый стор при загрузке — warn и пушим без дедупа, не роняем гейт', () => {
        const loadPushedKeysFn = vi.fn(() => {
            throw new Error('Unexpected end of JSON input');
        });
        const savePushedKeysFn = vi.fn();
        const sendFn = vi.fn(() => true);
        const logFn = vi.fn();
        const accepted = [
            { id: 1, severity: 'high', package: 'immutable', expiresAt: '2026-08-05' },
        ];
        expect(() =>
            pushAcceptedBaselineChanges(accepted, {
                loadPushedKeysFn,
                savePushedKeysFn,
                sendFn,
                logFn,
            }),
        ).not.toThrow();
        expect(sendFn).toHaveBeenCalledTimes(1); // пуш ушёл (деградация в «пушим всё»)
        expect(logFn.mock.calls.some(([msg]) => /нечитаем/.test(msg))).toBe(true);
    });

    it('обрезанный write стора — warn, гейт не краснеет (fail-open)', () => {
        const loadPushedKeysFn = vi.fn(() => []);
        const savePushedKeysFn = vi.fn(() => {
            throw new Error('ENOSPC');
        });
        const sendFn = vi.fn(() => true);
        const logFn = vi.fn();
        const accepted = [
            { id: 1, severity: 'high', package: 'immutable', expiresAt: '2026-08-05' },
        ];
        expect(() =>
            pushAcceptedBaselineChanges(accepted, {
                loadPushedKeysFn,
                savePushedKeysFn,
                sendFn,
                logFn,
            }),
        ).not.toThrow();
        expect(logFn.mock.calls.some(([msg]) => /не сохранён/.test(msg))).toBe(true);
    });

    // #239-ревью (⚪): полностью задедупленный accepted не должен молчать — иначе ночью
    // «а почему пуша не было». Одна строка «подавлен дедупом».
    it('всё задедуплено — логируем, что пуш подавлен намеренно', () => {
        const loadPushedKeysFn = vi.fn(() => ['1:high']);
        const savePushedKeysFn = vi.fn();
        const sendFn = vi.fn(() => true);
        const logFn = vi.fn();
        const accepted = [
            { id: 1, severity: 'high', package: 'immutable', expiresAt: '2026-08-05' },
        ];
        pushAcceptedBaselineChanges(accepted, {
            loadPushedKeysFn,
            savePushedKeysFn,
            sendFn,
            logFn,
        });
        expect(sendFn).not.toHaveBeenCalled();
        expect(logFn.mock.calls.some(([msg]) => /подавлен дедупом/.test(msg))).toBe(true);
    });

    // #239-ревью (🟡): baseline пробрасывается в mergePushedKeys для прореживания —
    // ключ удалённой из baseline записи не остаётся в сторе навечно.
    it('baseline прорежает стор при сохранении (ключ отсутствующей записи выкинут)', () => {
        const loadPushedKeysFn = vi.fn(() => ['1:high', '99:high']); // 99 больше нет в baseline
        const savePushedKeysFn = vi.fn();
        const sendFn = vi.fn(() => true);
        const accepted = [
            { id: 2, severity: 'high', package: 'fast-uri', expiresAt: '2026-08-05' },
        ];
        pushAcceptedBaselineChanges(accepted, {
            loadPushedKeysFn,
            savePushedKeysFn,
            sendFn,
            logFn: vi.fn(),
            baseline: [
                { id: 1, severity: 'high' },
                { id: 2, severity: 'high' },
            ],
        });
        // 99:high выкинут (нет в baseline), 1:high сохранён, 2:high добавлен.
        expect(savePushedKeysFn).toHaveBeenCalledWith(['1:high', '2:high']);
    });
});
