import { describe, expect, it } from 'vitest';
import { decodeReplay } from '@/entities/replays';
import { buildReplaySharePayload } from './build-replay-share-payload';

describe('buildReplaySharePayload', () => {
    it('строит URL вида /replay/<code> под заданным origin', () => {
        const { url } = buildReplaySharePayload({
            seed: 42,
            width: 800,
            height: 600,
            moves: [{ kind: 'fire', angle: 1.2, power: 10 }],
            origin: 'https://example.com',
        });

        expect(url).toMatch(/^https:\/\/example\.com\/replay\/[A-Za-z0-9_-]+$/);
    });

    it('кодирует код, который декодируется обратно в те же seed, размер и ходы', () => {
        const seed = 'daily-2026-07-19';
        const width = 800;
        const height = 600;
        const moves = [
            { kind: 'move' as const, delta: -150 },
            { kind: 'fire' as const, angle: -Math.PI / 3, power: 12 },
        ];

        const { url } = buildReplaySharePayload({
            seed,
            width,
            height,
            moves,
            origin: 'https://example.com',
        });
        const code = url.split('/replay/')[1];

        expect(decodeReplay(code)).toEqual({ seed, width, height, moves });
    });

    it('возвращает непустые title и text', () => {
        const { title, text } = buildReplaySharePayload({
            seed: 1,
            width: 800,
            height: 600,
            moves: [],
            origin: 'https://example.com',
        });

        expect(title?.length).toBeGreaterThan(0);
        expect(text.length).toBeGreaterThan(0);
    });
});
