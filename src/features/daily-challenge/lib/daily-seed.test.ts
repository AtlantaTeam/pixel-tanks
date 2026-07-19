import { describe, expect, it } from 'vitest';
import { getDailySeed } from './daily-seed';

describe('getDailySeed', () => {
    it('returns the same seed for two moments within the same UTC day', () => {
        const morning = new Date('2026-07-19T00:00:01.000Z');
        const evening = new Date('2026-07-19T23:59:59.000Z');
        expect(getDailySeed(morning)).toBe(getDailySeed(evening));
    });

    it('changes the seed right after UTC midnight', () => {
        const beforeMidnight = new Date('2026-07-19T23:59:59.999Z');
        const afterMidnight = new Date('2026-07-20T00:00:00.000Z');
        expect(getDailySeed(beforeMidnight)).not.toBe(getDailySeed(afterMidnight));
    });

    it('is not affected by local timezone offset, only UTC date', () => {
        // 2026-07-19 21:30 в UTC+5 — это ещё 2026-07-19 16:30 UTC
        const localLate = new Date('2026-07-19T21:30:00.000+05:00');
        expect(getDailySeed(localLate)).toBe(getDailySeed(new Date('2026-07-19T00:00:00.000Z')));
    });

    it('formats the seed as daily-YYYY-MM-DD', () => {
        expect(getDailySeed(new Date('2026-01-05T12:00:00.000Z'))).toBe('daily-2026-01-05');
    });

    it('defaults to the current date when called without an argument', () => {
        expect(getDailySeed()).toBe(getDailySeed(new Date()));
    });
});
