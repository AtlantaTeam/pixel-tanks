import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('payload', () => ({
    getPayload: vi.fn(async () => ({ create: createMock })),
}));
vi.mock('@/payload.config', () => ({ default: {} }));

const { submitDailyScore } = await import('./submit-daily-score');

describe('submitDailyScore', () => {
    beforeEach(() => {
        createMock.mockReset();
        createMock.mockResolvedValue({ id: '1' });
    });

    it('writes a score to the scores collection marked with the daily seed', async () => {
        await submitDailyScore({ seed: 'daily-2026-07-19', points: 42, opponent: 'Terminator' });

        expect(createMock).toHaveBeenCalledWith({
            collection: 'scores',
            data: expect.objectContaining({
                points: 42,
                opponent: 'Terminator',
                dailySeed: 'daily-2026-07-19',
            }),
        });
    });

    it('defaults the opponent to Terminator when not provided', async () => {
        await submitDailyScore({ seed: 'daily-2026-07-19', points: 10 });

        expect(createMock).toHaveBeenCalledWith({
            collection: 'scores',
            data: expect.objectContaining({ opponent: 'Terminator' }),
        });
    });

    it('rejects negative points without calling Payload', async () => {
        await expect(submitDailyScore({ seed: 'daily-2026-07-19', points: -5 })).rejects.toThrow();
        expect(createMock).not.toHaveBeenCalled();
    });

    it('rejects a non-integer points value', async () => {
        await expect(submitDailyScore({ seed: 'daily-2026-07-19', points: 1.5 })).rejects.toThrow();
        expect(createMock).not.toHaveBeenCalled();
    });

    it('rejects an empty seed', async () => {
        await expect(submitDailyScore({ seed: '', points: 10 })).rejects.toThrow();
        expect(createMock).not.toHaveBeenCalled();
    });
});
