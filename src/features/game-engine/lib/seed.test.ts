import { describe, expect, it } from 'vitest';
import { parseSeedParam } from './seed';

describe('parseSeedParam', () => {
    it('returns undefined when the param is missing', () => {
        expect(parseSeedParam(undefined)).toBeUndefined();
    });

    it('returns undefined for an empty string', () => {
        expect(parseSeedParam('')).toBeUndefined();
    });

    it('returns undefined for a whitespace-only string', () => {
        expect(parseSeedParam('   ')).toBeUndefined();
    });

    it('returns undefined when the param is repeated (array)', () => {
        expect(parseSeedParam(['42', '7'])).toBeUndefined();
    });

    it('returns the trimmed seed for a valid value', () => {
        expect(parseSeedParam(' 42 ')).toBe('42');
    });

    it('keeps non-numeric string seeds as-is', () => {
        expect(parseSeedParam('daily-2026-07-18')).toBe('daily-2026-07-18');
    });

    it('is deterministic: same input → same output', () => {
        expect(parseSeedParam('42')).toBe(parseSeedParam('42'));
    });
});
