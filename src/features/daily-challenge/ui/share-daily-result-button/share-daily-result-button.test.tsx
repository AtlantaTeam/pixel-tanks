import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareDailyResultButton } from './share-daily-result-button';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ShareDailyResultButton', () => {
    it('renders a "Поделиться" button', () => {
        render(<ShareDailyResultButton points={42} seed="daily-2026-07-19" />);
        expect(screen.getByRole('button', { name: /Поделиться/i })).toBeInTheDocument();
    });

    it('calls the Web Share API with the score and the daily-seed link on click', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { share, clipboard: { writeText: vi.fn() } });

        render(<ShareDailyResultButton points={42} seed="daily-2026-07-19" />);
        fireEvent.click(screen.getByRole('button', { name: /Поделиться/i }));

        await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
        const payload = share.mock.calls[0][0];
        expect(payload.text).toContain('42');
        expect(payload.url).toContain('daily-2026-07-19');
    });

    it('shows a confirmation when falling back to clipboard copy', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        render(<ShareDailyResultButton points={42} seed="daily-2026-07-19" />);
        fireEvent.click(screen.getByRole('button', { name: /Поделиться/i }));

        await screen.findByText(/скопирован/i);
    });
});
