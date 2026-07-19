import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareReplayButton } from './share-replay-button';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ShareReplayButton', () => {
    it('рендерит кнопку «Поделиться боем»', () => {
        render(<ShareReplayButton seed={42} width={800} height={600} moves={[]} />);
        expect(screen.getByRole('button', { name: /Поделиться боем/i })).toBeInTheDocument();
    });

    it('по клику вызывает Web Share API со ссылкой на реплей', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { share, clipboard: { writeText: vi.fn() } });

        render(
            <ShareReplayButton
                seed={42}
                width={800}
                height={600}
                moves={[{ kind: 'fire', angle: 1, power: 10 }]}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Поделиться боем/i }));

        await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
        const payload = share.mock.calls[0][0];
        expect(payload.url).toContain('/replay/');
    });

    it('показывает подтверждение при откате на копирование в буфер', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        render(<ShareReplayButton seed={42} width={800} height={600} moves={[]} />);
        fireEvent.click(screen.getByRole('button', { name: /Поделиться боем/i }));

        await screen.findByText(/скопирован/i);
    });
});
