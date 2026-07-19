import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareLink } from './share-link';

const payload = {
    title: 'Pocket Tanks',
    text: 'Смотри мой бой!',
    url: 'https://example.com/replay/abc123',
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('shareLink', () => {
    it('uses the Web Share API when available and reports "shared"', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { share, clipboard: { writeText: vi.fn() } });

        const status = await shareLink(payload);

        expect(share).toHaveBeenCalledWith(payload);
        expect(status).toBe('shared');
    });

    it('reports "cancelled" without touching the clipboard when the user aborts the share sheet', async () => {
        const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
        const writeText = vi.fn();
        vi.stubGlobal('navigator', { share, clipboard: { writeText } });

        const status = await shareLink(payload);

        expect(status).toBe('cancelled');
        expect(writeText).not.toHaveBeenCalled();
    });

    it('falls back to the clipboard when Web Share throws a non-abort error', async () => {
        const share = vi.fn().mockRejectedValue(new Error('not allowed'));
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { share, clipboard: { writeText } });

        const status = await shareLink(payload);

        expect(writeText).toHaveBeenCalledWith(`${payload.text} ${payload.url}`);
        expect(status).toBe('copied');
    });

    it('copies to the clipboard when the Web Share API is unavailable', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        const status = await shareLink(payload);

        expect(writeText).toHaveBeenCalledWith(`${payload.text} ${payload.url}`);
        expect(status).toBe('copied');
    });

    it('reports "unavailable" when clipboard.writeText rejects (no focus / permission denied)', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('Document is not focused'));
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        const status = await shareLink(payload);

        expect(status).toBe('unavailable');
    });

    it('reports "unavailable" when neither Web Share nor clipboard exist', async () => {
        vi.stubGlobal('navigator', {});

        const status = await shareLink(payload);

        expect(status).toBe('unavailable');
    });
});
