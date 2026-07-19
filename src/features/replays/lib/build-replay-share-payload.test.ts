import { describe, expect, it } from 'vitest';
import { decodeReplay } from '@/entities/replays';
import { buildReplayShareText } from './build-replay-share-payload';

describe('buildReplayShareText', () => {
    it('builds a URL to /replay/<code> under the given origin', () => {
        const { url } = buildReplayShareText({
            seed: 42,
            moves: [{ kind: 'fire', angle: 1.2, power: 10 }],
            origin: 'https://example.com',
        });

        expect(url).toMatch(/^https:\/\/example\.com\/replay\/[A-Za-z0-9_-]+$/);
    });

    it('encodes a code that decodes back to the same seed and moves', () => {
        const seed = 'daily-2026-07-19';
        const moves = [
            { kind: 'move' as const, delta: -150 },
            { kind: 'fire' as const, angle: -Math.PI / 3, power: 12 },
        ];

        const { url } = buildReplayShareText({ seed, moves, origin: 'https://example.com' });
        const code = url.split('/replay/')[1];

        expect(decodeReplay(code)).toEqual({ seed, moves });
    });

    it('returns a non-empty title and text', () => {
        const { title, text } = buildReplayShareText({
            seed: 1,
            moves: [],
            origin: 'https://example.com',
        });

        expect(title.length).toBeGreaterThan(0);
        expect(text.length).toBeGreaterThan(0);
    });
});
