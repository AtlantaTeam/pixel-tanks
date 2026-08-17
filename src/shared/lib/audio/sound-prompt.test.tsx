import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SoundPrompt } from './sound-prompt';

describe('SoundPrompt', () => {
    // Видимость теперь читает персистентный флаг (#584, `sound-hint.ts`) —
    // без чистки localStorage тест из предыдущего дела заражал бы следующий.
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

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

    it('#584: подсказка на новом экране не появляется заново, если уже видели её раньше', () => {
        // Переход `/` → `/game` — новый маунт `SoundPrompt`; без персистентного
        // флага он показал бы подсказку заново на каждом бою (см. `sound-hint.ts`).
        localStorage.setItem('pt-sound-hint-seen', '1');

        const { container } = render(<SoundPrompt />);

        expect(container.firstElementChild).toHaveClass('opacity-0');
        expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    });

    it('#584: гашение на одном экране переживает следующий маунт (флаг общий)', () => {
        const { container, unmount } = render(<SoundPrompt />);
        fireEvent.pointerDown(window);
        expect(container.firstElementChild).toHaveClass('opacity-0');
        unmount();

        // Симулирует переход на другой экран — новый инстанс `SoundPrompt`.
        const { container: nextContainer } = render(<SoundPrompt />);
        expect(nextContainer.firstElementChild).toHaveClass('opacity-0');
    });

    it('несёт заметку про бесшумный переключатель iPhone текстом, не только визуально', () => {
        render(<SoundPrompt />);
        expect(screen.getByText(/iphone/i)).toBeInTheDocument();
    });
});
