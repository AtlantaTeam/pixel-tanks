import { describe, expect, it, vi } from 'vitest';
import {
    collectAdvisories,
    countBySeverity,
    diffBaseline,
    loadBaseline,
    runAudit,
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

    it('пустой baseline: любая гейтимая находка — fresh', () => {
        expect(diffBaseline([{ id: 7 }], []).fresh.map((f) => f.id)).toEqual([7]);
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
