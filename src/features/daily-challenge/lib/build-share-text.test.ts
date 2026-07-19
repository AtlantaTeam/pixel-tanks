import { describe, expect, it } from 'vitest';
import { buildDailyShareText } from './build-share-text';

describe('buildDailyShareText', () => {
    it('includes the score in the share text', () => {
        const { text } = buildDailyShareText({
            points: 42,
            seed: 'daily-2026-07-19',
            origin: 'https://example.com',
        });
        expect(text).toContain('42');
    });

    it('builds a URL pointing to the game with the given seed', () => {
        const { url } = buildDailyShareText({
            points: 0,
            seed: 'daily-2026-07-19',
            origin: 'https://example.com',
        });
        expect(url).toBe('https://example.com/game?seed=daily-2026-07-19');
    });

    it('returns a non-empty title', () => {
        const { title } = buildDailyShareText({
            points: 10,
            seed: 'daily-2026-07-19',
            origin: 'https://example.com',
        });
        expect(title.length).toBeGreaterThan(0);
    });
});
