import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareReplayButton } from './share-replay-button';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ShareReplayButton', () => {
    it('renders a "Поделиться боем" button', () => {
        render(<ShareReplayButton seed={42} moves={[]} />);
        expect(screen.getByRole('button', { name: /Поделиться боем/i })).toBeInTheDocument();
    });

    it('calls the Web Share API with a link to the replay on click', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { share, clipboard: { writeText: vi.fn() } });

        render(<ShareReplayButton seed={42} moves={[{ kind: 'fire', angle: 1, power: 10 }]} />);
        fireEvent.click(screen.getByRole('button', { name: /Поделиться боем/i }));

        await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
        const payload = share.mock.calls[0][0];
        expect(payload.url).toContain('/replay/');
    });

    it('shows a confirmation when falling back to clipboard copy', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        render(<ShareReplayButton seed={42} moves={[]} />);
        fireEvent.click(screen.getByRole('button', { name: /Поделиться боем/i }));

        await screen.findByText(/скопирован/i);
    });
});
