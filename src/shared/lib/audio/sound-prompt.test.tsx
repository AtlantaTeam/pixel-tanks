import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SoundPrompt } from './sound-prompt';

describe('SoundPrompt', () => {
    it('показывает подсказку до первого жеста', () => {
        render(<SoundPrompt />);
        expect(screen.getByText(/нажми/i)).toBeInTheDocument();
    });

    it('рисует play через <Icon>, а не эмодзи-глиф', () => {
        const { container } = render(<SoundPrompt />);

        expect(container.querySelector('svg')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{25A0}-\u{25FF}]/u);
    });

    it('скрывается после первого pointerdown где угодно на странице', () => {
        render(<SoundPrompt />);
        fireEvent.pointerDown(window);
        expect(screen.queryByText(/нажми/i)).not.toBeInTheDocument();
    });

    it('скрывается после нажатия клавиши', () => {
        render(<SoundPrompt />);
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(screen.queryByText(/нажми/i)).not.toBeInTheDocument();
    });
});
