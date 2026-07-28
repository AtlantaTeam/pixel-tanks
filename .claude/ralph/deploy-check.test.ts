// Юнит-тесты модуля деплой-проверки (#364). Здесь проверяется САМА фабрика
// createDeployCheckModule — что она собирает рабочие функции из синтетического env,
// независимо от ralph.js. Проход «через ре-экспорт ralph.js» уже покрыт ralph.test.js (те же
// функции, но с боевым контекстом раннера); тут — контракт extraction'а: модуль
// самодостаточен и переносим (цель фазы 3), а не «работает только пока его зовёт ralph.js».
import { describe, it, expect, vi } from 'vitest';
import type { DeployCheckEnv } from './deploy-check.ts';
import { createDeployCheckModule } from './deploy-check.ts';

const SHA40_RE = /^[0-9a-f]{40}$/;
const shq = (v: unknown) => `'${String(v).replace(/'/g, `'\\''`)}'`;

// Синтетический env: побочки (ghJson/guardSideEffect) по умолчанию громко падают, если
// функция под тестом дёрнет их без явного override, — забытый override становится ошибкой
// теста, а не тихим проходом через боевой gh/curl. guardSideEffect по умолчанию throw'ит —
// ровно то же, что и боевой предохранитель #138 делает под RALPH_NO_SIDE_EFFECTS=1: тест,
// забывший подменить execFn, должен упасть на попытке уйти в настоящий curl.
function makeEnv(over: Partial<DeployCheckEnv> = {}): DeployCheckEnv {
    return {
        getConfig: () => ({}),
        ghJson: () => {
            throw new Error('ghJson не подменён в тесте');
        },
        shq,
        log: () => {},
        sleep: () => {},
        guardSideEffect: (what: string) => {
            throw new Error(`побочка без override в тесте: ${what}`);
        },
        positiveIntOrDefault: (value: unknown, dflt: number) =>
            typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : dflt,
        SHA40_RE,
        ...over,
    };
}

describe('deployPhasePlaceholder — маркер точки цикла (#87)', () => {
    it('логирует упоминание milestone фазы', () => {
        const logFn = vi.fn();
        const { deployPhasePlaceholder } = createDeployCheckModule(makeEnv());
        deployPhasePlaceholder({ milestone: 'Фаза 3' }, { logFn });
        expect(logFn).toHaveBeenCalledTimes(1);
        expect(logFn.mock.calls[0][0]).toContain('Фаза 3');
    });
});

describe('mergedShaOf — sha squash-мерджа PR (#163)', () => {
    const SHA = 'c'.repeat(40);

    it('возвращает oid mergeCommit, номер PR уходит через shq', () => {
        const ghJsonFn = vi.fn((_cmd: string) => ({ mergeCommit: { oid: SHA } }));
        const { mergedShaOf } = createDeployCheckModule(makeEnv());
        expect(mergedShaOf(12, { ghJsonFn })).toBe(SHA);
        expect(ghJsonFn.mock.calls[0][0]).toContain("gh pr view '12'");
    });

    it('fail-closed: mergeCommit отсутствует/невалиден → бросает после исчерпания ретраев', () => {
        const { mergedShaOf } = createDeployCheckModule(makeEnv());
        expect(() =>
            mergedShaOf(12, { ghJsonFn: () => ({ mergeCommit: null }), sleepFn: () => {} }),
        ).toThrow();
    });

    it('транзиентный mergeCommit: null → ретрай, зелёный на следующей попытке', () => {
        let call = 0;
        const ghJsonFn = vi.fn(() => {
            call++;
            return call === 1 ? { mergeCommit: null } : { mergeCommit: { oid: SHA } };
        });
        const sleepFn = vi.fn();
        const { mergedShaOf } = createDeployCheckModule(makeEnv());
        expect(mergedShaOf(12, { ghJsonFn, sleepFn })).toBe(SHA);
        expect(ghJsonFn).toHaveBeenCalledTimes(2);
        expect(sleepFn).toHaveBeenCalledTimes(1); // пауза только между попытками
    });

    it('устойчивый null исчерпывает ровно attempts попыток и бросает', () => {
        const ghJsonFn = vi.fn(() => ({ mergeCommit: null }));
        const sleepFn = vi.fn();
        const { mergedShaOf } = createDeployCheckModule(makeEnv());
        expect(() => mergedShaOf(12, { ghJsonFn, sleepFn, attempts: 3 })).toThrow();
        expect(ghJsonFn).toHaveBeenCalledTimes(3);
        expect(sleepFn).toHaveBeenCalledTimes(2); // паузы только МЕЖДУ попытками
    });

    it('только ЧТЕНИЕ: "gh pr view", без merge/close/edit', () => {
        const ghJsonFn = vi.fn((_cmd: string) => ({ mergeCommit: { oid: SHA } }));
        const { mergedShaOf } = createDeployCheckModule(makeEnv());
        mergedShaOf(1, { ghJsonFn });
        const cmd = ghJsonFn.mock.calls[0][0] as string;
        expect(cmd).toMatch(/^gh pr view\b/);
        expect(cmd).not.toMatch(/\b(merge|close|edit|delete)\b/);
    });
});

describe('deployWaitMessage — формат сообщения ожидания (#TFO89)', () => {
    it('содержит workflow, короткий sha и таймаут в минутах', () => {
        const { deployWaitMessage } = createDeployCheckModule(makeEnv());
        const msg = deployWaitMessage('deploy.yml', 'a'.repeat(40), 1_200_000);
        expect(msg).toContain('deploy.yml');
        expect(msg).toContain('aaaaaaaa');
        expect(msg).toContain('20 мин');
    });
});

describe('waitForDeployRun — ожидание итога deploy-workflow на смердженном sha (#163)', () => {
    const SHA = 'd'.repeat(40);

    it('run найден в статусе completed → возвращает conclusion сразу, без сна', () => {
        const ghJsonFn = vi.fn(() => [
            { databaseId: 1, headSha: SHA, status: 'completed', conclusion: 'success', url: 'u' },
        ]);
        const sleepFn = vi.fn();
        const { waitForDeployRun } = createDeployCheckModule(makeEnv());
        const out = waitForDeployRun(
            SHA,
            { deployCheck: { workflow: 'deploy.yml', timeoutMs: 100, pollIntervalMs: 20 } },
            { ghJsonFn, sleepFn, logFn: () => {}, nowFn: () => 0 },
        );
        expect(out).toEqual({
            status: 'completed',
            conclusion: 'success',
            sha: SHA,
            url: 'u',
            runId: 1,
        });
        expect(sleepFn).not.toHaveBeenCalled();
    });

    it('run не найден до таймаута → not-found', () => {
        const ghJsonFn = vi.fn(() => []);
        let now = 0;
        const nowFn = () => now;
        const sleepFn = vi.fn((ms: number) => {
            now += ms;
        });
        const { waitForDeployRun } = createDeployCheckModule(makeEnv());
        const out = waitForDeployRun(
            SHA,
            { deployCheck: { timeoutMs: 100, pollIntervalMs: 20 } },
            { ghJsonFn, sleepFn, logFn: () => {}, nowFn },
        );
        expect(out.status).toBe('not-found');
    });

    it('run найден, но не completed до таймаута → timeout с последним статусом', () => {
        const ghJsonFn = vi.fn(() => [
            { databaseId: 2, headSha: SHA, status: 'in_progress', conclusion: null, url: 'u2' },
        ]);
        let now = 0;
        const nowFn = () => now;
        const sleepFn = vi.fn((ms: number) => {
            now += ms;
        });
        const { waitForDeployRun } = createDeployCheckModule(makeEnv());
        const out = waitForDeployRun(
            SHA,
            { deployCheck: { timeoutMs: 100, pollIntervalMs: 20 } },
            { ghJsonFn, sleepFn, logFn: () => {}, nowFn },
        );
        expect(out).toEqual({
            status: 'timeout',
            conclusion: null,
            sha: SHA,
            url: 'u2',
            runId: 2,
        });
    });

    it('устойчивая ошибка чтения gh run не роняет ожидание — доходит до таймаута', () => {
        const ghJsonFn = vi.fn(() => {
            throw new Error('network blip');
        });
        let now = 0;
        const nowFn = () => now;
        const sleepFn = vi.fn((ms: number) => {
            now += ms;
        });
        const { waitForDeployRun } = createDeployCheckModule(makeEnv());
        const out = waitForDeployRun(
            SHA,
            { deployCheck: { timeoutMs: 100, pollIntervalMs: 20 } },
            { ghJsonFn, sleepFn, logFn: () => {}, nowFn },
        );
        expect(out.status).toBe('not-found');
    });

    it('невалидный sha → бросает fail-closed, не молчит', () => {
        const { waitForDeployRun } = createDeployCheckModule(makeEnv());
        expect(() =>
            waitForDeployRun('not-a-sha', {}, { ghJsonFn: () => [] as unknown[] }),
        ).toThrow();
    });

    it('имя workflow из конфига уходит через shq в gh run list', () => {
        const ghJsonFn = vi.fn((_cmd: string) => [
            { databaseId: 5, headSha: SHA, status: 'completed', conclusion: 'success', url: 'u' },
        ]);
        const { waitForDeployRun } = createDeployCheckModule(makeEnv());
        waitForDeployRun(
            SHA,
            { deployCheck: { workflow: 'release.yml', timeoutMs: 10, pollIntervalMs: 5 } },
            { ghJsonFn, sleepFn: () => {}, logFn: () => {}, nowFn: () => 0 },
        );
        expect(ghJsonFn.mock.calls[0][0]).toContain("--workflow 'release.yml'");
    });

    it('только ЧТЕНИЕ: "gh run list", без cancel/rerun/delete/merge/close', () => {
        const ghJsonFn = vi.fn((_cmd: string) => [
            { databaseId: 1, headSha: SHA, status: 'completed', conclusion: 'success', url: 'u' },
        ]);
        const { waitForDeployRun } = createDeployCheckModule(makeEnv());
        waitForDeployRun(
            SHA,
            { deployCheck: { workflow: 'deploy.yml', timeoutMs: 100, pollIntervalMs: 20 } },
            { ghJsonFn, sleepFn: () => {}, logFn: () => {}, nowFn: () => 0 },
        );
        const cmd = ghJsonFn.mock.calls[0][0] as string;
        expect(cmd).toMatch(/^gh run list\b/);
        expect(cmd).not.toMatch(/\b(cancel|rerun|delete|merge|close|revert)\b/);
    });
});

describe('probeHttpStatus — HTTP-код через curl (#164)', () => {
    it('корректный числовой код от curl → возвращает его как число', () => {
        const execFn = vi.fn(() => '200');
        const { probeHttpStatus } = createDeployCheckModule(makeEnv());
        expect(probeHttpStatus('https://pixeltanks.ru', 10, execFn)).toBe(200);
    });

    it('curl бросает (таймаут/DNS) → 0, не пробрасывает исключение', () => {
        const execFn = vi.fn(() => {
            throw new Error('curl: (28) timeout');
        });
        const { probeHttpStatus } = createDeployCheckModule(makeEnv());
        expect(probeHttpStatus('https://pixeltanks.ru', 10, execFn)).toBe(0);
    });

    it('нечисловой вывод curl → 0 (fail-closed, не «сойдёт за живой»)', () => {
        const execFn = vi.fn(() => '');
        const { probeHttpStatus } = createDeployCheckModule(makeEnv());
        expect(probeHttpStatus('https://pixeltanks.ru', 10, execFn)).toBe(0);
    });

    it('только ЧТЕНИЕ: аргументы curl не содержат мутирующих флагов, url — отдельный элемент argv', () => {
        const execFn = vi.fn((_file: string, _args: string[]) => '200');
        const { probeHttpStatus } = createDeployCheckModule(makeEnv());
        probeHttpStatus('https://pixeltanks.ru', 10, execFn);
        const [bin, args] = execFn.mock.calls[0];
        expect(bin).toBe('curl');
        expect(args).toContain('https://pixeltanks.ru');
        expect(args).not.toContain('-X');
        expect(args).not.toContain('POST');
    });

    it('дефолтный execFn не подменён в тесте → guardSideEffect стопит его ДО настоящего curl (#138)', () => {
        // probeHttpStatus гасит ЛЮБОЕ исключение execFn в 0 (см. тест выше — «curl бросает
        // → 0, не пробрасывает») — бросок guardSideEffect не исключение из этого правила.
        // Поэтому здесь проверяется не throw наружу, а то, что результат — 0 (не настоящий
        // HTTP-код): guardSideEffect (throw'ящий, как боевой предохранитель #138 под
        // RALPH_NO_SIDE_EFFECTS=1) должен остановить дефолт РАНЬШE execFileSync — иначе
        // это ушёл бы в настоящий сетевой curl к прод-домену прямо из юнит-теста.
        const guardSideEffect = vi.fn(() => {
            throw new Error('side effect');
        });
        const { probeHttpStatus } = createDeployCheckModule(makeEnv({ guardSideEffect }));
        expect(probeHttpStatus('https://pixeltanks.ru', 10)).toBe(0);
        expect(guardSideEffect).toHaveBeenCalledWith('curl (probeHttpStatus)');
    });
});

describe('checkProdHealth — HTTP-healthcheck главной страницы прода (#164)', () => {
    it('первая попытка 200 → ok:true, без retry-сна', () => {
        const execFn = vi.fn(() => '200');
        const sleepFn = vi.fn();
        const { checkProdHealth } = createDeployCheckModule(makeEnv());
        const out = checkProdHealth({}, { execFn, sleepFn, logFn: () => {} });
        expect(out).toEqual({ ok: true, status: 200, url: 'https://pixeltanks.ru' });
        expect(sleepFn).not.toHaveBeenCalled();
    });

    it('502 → 502 → 200: успевает на третьей попытке (ретрай между попытками работает)', () => {
        let call = 0;
        const execFn = vi.fn(() => {
            call++;
            return call < 3 ? '502' : '200';
        });
        const sleepFn = vi.fn();
        const { checkProdHealth } = createDeployCheckModule(makeEnv());
        const out = checkProdHealth(
            { deployCheck: { healthRetries: 3 } },
            { execFn, sleepFn, logFn: () => {} },
        );
        expect(out.ok).toBe(true);
        expect(execFn).toHaveBeenCalledTimes(3);
        expect(sleepFn).toHaveBeenCalledTimes(2);
    });

    it('устойчивый красный исчерпывает ретраи → ok:false с последним кодом', () => {
        const execFn = vi.fn(() => '503');
        const { checkProdHealth } = createDeployCheckModule(makeEnv());
        const out = checkProdHealth(
            { deployCheck: { healthRetries: 2 } },
            { execFn, sleepFn: () => {}, logFn: () => {} },
        );
        expect(out).toEqual({ ok: false, status: 503, url: 'https://pixeltanks.ru' });
        expect(execFn).toHaveBeenCalledTimes(2);
    });

    it('healthUrl из конфига переопределяет прод-дефолт', () => {
        const execFn = vi.fn((_file: string, _args: string[]) => '200');
        const { checkProdHealth } = createDeployCheckModule(makeEnv());
        checkProdHealth(
            { deployCheck: { healthUrl: 'https://staging.example.com', healthRetries: 1 } },
            { execFn, sleepFn: () => {}, logFn: () => {} },
        );
        expect(execFn.mock.calls[0][1]).toContain('https://staging.example.com');
    });

    it('без конфига deployCheck использует прод-дефолт https://pixeltanks.ru', () => {
        const execFn = vi.fn((_file: string, _args: string[]) => '200');
        const { checkProdHealth } = createDeployCheckModule(makeEnv());
        checkProdHealth({}, { execFn, sleepFn: () => {}, logFn: () => {} });
        expect(execFn.mock.calls[0][1]).toContain('https://pixeltanks.ru');
    });

    it('кривой healthUrl (не http/https) → fail-closed ok:false, curl не зовётся', () => {
        const execFn = vi.fn(() => '200');
        const { checkProdHealth } = createDeployCheckModule(makeEnv());
        const out = checkProdHealth(
            { deployCheck: { healthUrl: '-oops' } },
            { execFn, sleepFn: () => {}, logFn: () => {} },
        );
        expect(out.ok).toBe(false);
        expect(execFn).not.toHaveBeenCalled();
    });

    it('curl зовётся только на чтение (GET) — без -X/-d/--data/--upload-file', () => {
        const execFn = vi.fn((_file: string, _args: string[]) => '200');
        const { checkProdHealth } = createDeployCheckModule(makeEnv());
        checkProdHealth(
            { deployCheck: { healthUrl: 'https://pixeltanks.ru', healthRetries: 1 } },
            { execFn, sleepFn: () => {}, logFn: () => {} },
        );
        expect(execFn).toHaveBeenCalledTimes(1);
        const [bin, args] = execFn.mock.calls[0];
        expect(bin).toBe('curl');
        expect(args).not.toContain('-X');
        expect(args).not.toContain('-d');
        expect(args).not.toContain('--data');
        expect(args).not.toContain('--upload-file');
    });

    it('дефолтный execFn не подменён в тесте → guardSideEffect стопит его ДО настоящего curl (#138)', () => {
        // Тот же приём, что у probeHttpStatus выше: guardSideEffect throw'ит, но
        // probeHttpStatus гасит любое исключение execFn в 0 — наружу не бросает. Здесь
        // проверяется, что дефолт вообще прошёл через guardSideEffect (а не сразу в
        // настоящий execFileSync) и итог — честный ok:false с кодом 0.
        const guardSideEffect = vi.fn(() => {
            throw new Error('side effect');
        });
        const { checkProdHealth } = createDeployCheckModule(makeEnv({ guardSideEffect }));
        const out = checkProdHealth(
            { deployCheck: { healthRetries: 1 } },
            { sleepFn: () => {}, logFn: () => {} },
        );
        expect(out).toEqual({ ok: false, status: 0, url: 'https://pixeltanks.ru' });
        expect(guardSideEffect).toHaveBeenCalledWith('curl (checkProdHealth)');
    });
});

describe('isWorkflowGreen — единый предикат «workflow зелёный» (#THS8S)', () => {
    it('completed + success → true', () => {
        const { isWorkflowGreen } = createDeployCheckModule(makeEnv());
        expect(isWorkflowGreen({ status: 'completed', conclusion: 'success' } as never)).toBe(true);
    });

    it('completed + failure → false', () => {
        const { isWorkflowGreen } = createDeployCheckModule(makeEnv());
        expect(isWorkflowGreen({ status: 'completed', conclusion: 'failure' } as never)).toBe(
            false,
        );
    });

    it('timeout/not-found/null → false', () => {
        const { isWorkflowGreen } = createDeployCheckModule(makeEnv());
        expect(isWorkflowGreen({ status: 'timeout', conclusion: null } as never)).toBe(false);
        expect(isWorkflowGreen({ status: 'not-found', conclusion: null } as never)).toBe(false);
        expect(isWorkflowGreen(null)).toBe(false);
    });
});

describe('classifyDeployOutcome — итог деплоя зелёный/красный (#165)', () => {
    it('workflow success + здоровый прод → зелёный (red=false)', () => {
        const { classifyDeployOutcome } = createDeployCheckModule(makeEnv());
        const v = classifyDeployOutcome({ status: 'completed', conclusion: 'success' } as never, {
            ok: true,
            status: 200,
            url: 'u',
        });
        expect(v.red).toBe(false);
    });

    it('workflow success без healthcheck (health=null) → зелёный: страховка, workflow сам ок', () => {
        const { classifyDeployOutcome } = createDeployCheckModule(makeEnv());
        const v = classifyDeployOutcome(
            { status: 'completed', conclusion: 'success' } as never,
            null,
        );
        expect(v.red).toBe(false);
    });

    it('workflow failure → красный независимо от health', () => {
        const { classifyDeployOutcome } = createDeployCheckModule(makeEnv());
        const v = classifyDeployOutcome(
            { status: 'completed', conclusion: 'failure' } as never,
            null,
        );
        expect(v.red).toBe(true);
        expect(v.reason).toContain('failure');
    });

    it('workflow timeout → красный, reason содержит статус', () => {
        const { classifyDeployOutcome } = createDeployCheckModule(makeEnv());
        const v = classifyDeployOutcome({ status: 'timeout', conclusion: null } as never, null);
        expect(v.red).toBe(true);
        expect(v.reason).toContain('timeout');
    });

    it('workflow not-found → красный', () => {
        const { classifyDeployOutcome } = createDeployCheckModule(makeEnv());
        const v = classifyDeployOutcome({ status: 'not-found', conclusion: null } as never, null);
        expect(v.red).toBe(true);
    });

    it('workflow success, но прод не здоров → красный с HTTP-кодом в reason', () => {
        const { classifyDeployOutcome } = createDeployCheckModule(makeEnv());
        const v = classifyDeployOutcome({ status: 'completed', conclusion: 'success' } as never, {
            ok: false,
            status: 502,
            url: 'u',
        });
        expect(v.red).toBe(true);
        expect(v.reason).toContain('502');
    });

    it('outcome=null → красный (unknown), не бросает', () => {
        const { classifyDeployOutcome } = createDeployCheckModule(makeEnv());
        const v = classifyDeployOutcome(null, null);
        expect(v.red).toBe(true);
        expect(v.reason).toContain('unknown');
    });
});
