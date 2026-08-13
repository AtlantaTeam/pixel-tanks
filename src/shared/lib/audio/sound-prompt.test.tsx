import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SoundPrompt } from './sound-prompt';

describe('SoundPrompt', () => {
    it('показывает подсказку до первого жеста', () => {
        render(<SoundPrompt />);
        expect(screen.getByText(/нажми/i)).toBeVisible();
    });

    it('рисует play через <Icon>, а не эмодзи-глиф', () => {
        const { container } = render(<SoundPrompt />);

        expect(container.querySelector('svg')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{25A0}-\u{25FF}]/u);
    });

    it('гаснет после первого pointerdown, НЕ схлопывая раскладку (#522)', () => {
        // Раньше промпт возвращал null — колонка схлопывалась, и вся страница
        // подскакивала под курсором ровно в момент клика. Место за ним остаётся.
        const { container } = render(<SoundPrompt />);
        const prompt = container.firstElementChild as HTMLElement;
        expect(prompt).toBeInTheDocument();

        fireEvent.pointerDown(window);

        expect(prompt).toBeInTheDocument();
        expect(prompt).toHaveClass('opacity-0');
        expect(prompt).toHaveAttribute('aria-hidden', 'true');
    });

    it('гаснет после нажатия клавиши', () => {
        const { container } = render(<SoundPrompt />);
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(container.firstElementChild).toHaveClass('opacity-0');
    });

    it('погашенный промпт не перехватывает клики по тому, что под ним', () => {
        const { container } = render(<SoundPrompt />);
        fireEvent.pointerDown(window);
        expect(container.firstElementChild).toHaveClass('pointer-events-none');
    });
});
