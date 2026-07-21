import { describe, expect, it, vi } from 'vitest';
import { countBySeverity, exceedsThreshold, runAudit, THRESHOLDS } from './security-audit.mjs';

// #83: детерминированный security-скан прод-гейта — статический анализ npm audit --json,
// решение "красный/зелёный" через ПОРОГ находок (не через "есть хоть одна high"). На
// момент issue реальный npm audit по текущим зависимостям (Payload 3 бета) уже даёт high
// у транзитивных пакетов (undici/uuid), не чинящихся без --force на фреймворк — presence-
// гейт (`--audit-level=high`) был бы вечно красным. Порог ловит РОСТ находок, не сам факт
// существующего, сегодня не устранимого долга.
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

describe('exceedsThreshold', () => {
    it('красный при хоть одной critical (нулевая терпимость)', () => {
        expect(exceedsThreshold({ critical: 1, high: 0, moderate: 0, low: 0 }, THRESHOLDS)).toBe(
            true,
        );
    });

    it('красный, когда high СТРОГО больше порога', () => {
        expect(
            exceedsThreshold(
                { critical: 0, high: THRESHOLDS.high + 1, moderate: 0, low: 0 },
                THRESHOLDS,
            ),
        ).toBe(true);
    });

    it('значение РОВНО на пороге — ещё зелёное (порог = "выше", не "равно или выше")', () => {
        expect(
            exceedsThreshold(
                { critical: 0, high: THRESHOLDS.high, moderate: 0, low: 0 },
                THRESHOLDS,
            ),
        ).toBe(false);
    });

    it('moderate/low не гейтятся порогом — шум dev-тулчейна не должен красить прод-гейт', () => {
        expect(
            exceedsThreshold({ critical: 0, high: 0, moderate: 999, low: 999 }, THRESHOLDS),
        ).toBe(false);
    });
});

describe('runAudit', () => {
    it('парсит JSON из stdout npm audit', () => {
        const spawnFn = vi.fn(() => ({
            stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 1 } } }),
            status: 1,
        }));
        expect(runAudit(spawnFn)).toEqual({ metadata: { vulnerabilities: { high: 1 } } });
        expect(spawnFn).toHaveBeenCalledWith(
            'npm',
            ['audit', '--json'],
            expect.objectContaining({ encoding: 'utf8' }),
        );
    });

    it('бросает, если npm audit не вернул stdout (сеть недоступна и т.п.) — fail-closed', () => {
        const spawnFn = vi.fn(() => ({ stdout: '', status: null, error: new Error('ENOENT') }));
        expect(() => runAudit(spawnFn)).toThrow();
    });
});
