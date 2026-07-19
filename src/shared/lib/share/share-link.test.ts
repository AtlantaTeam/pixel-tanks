import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareLink } from './share-link';

const payload = {
    title: 'Pixel Tanks',
    text: 'Смотри мой бой!',
    url: 'https://example.com/replay/abc123',
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('shareLink', () => {
    it('использует Web Share API, когда он доступен, и возвращает «shared»', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { share, clipboard: { writeText: vi.fn() } });

        const status = await shareLink(payload);

        expect(share).toHaveBeenCalledWith(payload);
        expect(status).toBe('shared');
    });

    it('возвращает «cancelled» без обращения к буферу, когда пользователь отменил шаринг', async () => {
        const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
        const writeText = vi.fn();
        vi.stubGlobal('navigator', { share, clipboard: { writeText } });

        const status = await shareLink(payload);

        expect(status).toBe('cancelled');
        expect(writeText).not.toHaveBeenCalled();
    });

    it('откатывается на буфер, когда Web Share бросает не-abort ошибку', async () => {
        const share = vi.fn().mockRejectedValue(new Error('not allowed'));
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { share, clipboard: { writeText } });

        const status = await shareLink(payload);

        expect(writeText).toHaveBeenCalledWith(`${payload.text} ${payload.url}`);
        expect(status).toBe('copied');
    });

    it('копирует в буфер, когда Web Share API недоступен', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        const status = await shareLink(payload);

        expect(writeText).toHaveBeenCalledWith(`${payload.text} ${payload.url}`);
        expect(status).toBe('copied');
    });

    it('возвращает «unavailable», когда clipboard.writeText отклонён (нет фокуса / нет прав)', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('Document is not focused'));
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        const status = await shareLink(payload);

        expect(status).toBe('unavailable');
    });

    it('возвращает «unavailable», когда нет ни Web Share, ни буфера обмена', async () => {
        vi.stubGlobal('navigator', {});

        const status = await shareLink(payload);

        expect(status).toBe('unavailable');
    });
});
