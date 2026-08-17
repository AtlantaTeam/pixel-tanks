import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SoundHintToast } from './sound-hint-toast';

describe('SoundHintToast (issue #584 — подсказка звука на боевом экране)', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('видна до первого жеста, пока звук не разблокирован', () => {
        render(<SoundHintToast />);
        expect(screen.getByText(/нажми/i)).toBeVisible();
    });

    it('гаснет после первого жеста и не перехватывает клики', () => {
        const { container } = render(<SoundHintToast />);
        fireEvent.pointerDown(window);

        const prompt = container.querySelector('p');
        expect(prompt).toHaveClass('opacity-0');
        expect(prompt).toHaveClass('pointer-events-none');
    });

    it('уже увиденная подсказка (флаг с другого экрана) не оживает заново', () => {
        localStorage.setItem('pt-sound-hint-seen', '1');
        const { container } = render(<SoundHintToast />);

        expect(container.querySelector('p')).toHaveClass('opacity-0');
    });

    it('обёртка не перехватывает клики по арене под ней', () => {
        const { container } = render(<SoundHintToast />);
        expect(container.firstElementChild).toHaveClass('pointer-events-none');
    });
});
