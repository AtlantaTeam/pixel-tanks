import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('payload', () => ({
    getPayload: vi.fn(async () => ({ create: createMock })),
}));
vi.mock('@/payload.config', () => ({ default: {} }));

const { submitDailyScore, MAX_DAILY_POINTS } = await import('./submit-daily-score');

// Фиксируем «сегодня», чтобы daily-2026-07-19 совпадал с getDailySeed().
const TODAY_SEED = 'daily-2026-07-19';

describe('submitDailyScore', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'));
        createMock.mockReset();
        createMock.mockResolvedValue({ id: '1' });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("writes a score to the scores collection marked with today's daily seed", async () => {
        await submitDailyScore({ seed: TODAY_SEED, points: 42, opponent: 'Terminator' });

        expect(createMock).toHaveBeenCalledWith({
            collection: 'scores',
            data: expect.objectContaining({
                points: 42,
                opponent: 'Terminator',
                dailySeed: TODAY_SEED,
            }),
        });
    });

    it('passes opponent through as-is (defaults come from the collection, not here)', async () => {
        await submitDailyScore({ seed: TODAY_SEED, points: 10 });

        const data = createMock.mock.calls[0][0].data;
        expect(data.opponent).toBeUndefined();
    });

    it('rejects negative points without calling Payload', async () => {
        await expect(submitDailyScore({ seed: TODAY_SEED, points: -5 })).rejects.toThrow();
        expect(createMock).not.toHaveBeenCalled();
    });

    it('rejects a non-integer points value', async () => {
        await expect(submitDailyScore({ seed: TODAY_SEED, points: 1.5 })).rejects.toThrow();
        expect(createMock).not.toHaveBeenCalled();
    });

    it('rejects points above the upper bound', async () => {
        await expect(
            submitDailyScore({ seed: TODAY_SEED, points: MAX_DAILY_POINTS + 1 }),
        ).rejects.toThrow();
        await expect(
            submitDailyScore({ seed: TODAY_SEED, points: Number.MAX_SAFE_INTEGER }),
        ).rejects.toThrow();
        expect(createMock).not.toHaveBeenCalled();
    });

    it('rejects an empty seed', async () => {
        await expect(submitDailyScore({ seed: '', points: 10 })).rejects.toThrow();
        expect(createMock).not.toHaveBeenCalled();
    });

    it('rejects a non-daily seed', async () => {
        await expect(submitDailyScore({ seed: '42', points: 10 })).rejects.toThrow();
        await expect(submitDailyScore({ seed: 'daily-anything', points: 10 })).rejects.toThrow();
        expect(createMock).not.toHaveBeenCalled();
    });

    it('rejects a well-formed daily seed from another day', async () => {
        await expect(submitDailyScore({ seed: 'daily-2026-07-18', points: 10 })).rejects.toThrow();
        await expect(submitDailyScore({ seed: 'daily-2026-07-20', points: 10 })).rejects.toThrow();
        expect(createMock).not.toHaveBeenCalled();
    });
});
