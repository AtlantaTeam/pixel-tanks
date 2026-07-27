import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PauseOverlay } from './pause-overlay';

function renderOverlay(overrides: Partial<Parameters<typeof PauseOverlay>[0]> = {}) {
    const onResume = vi.fn();
    const onRestart = vi.fn();
    const onExitToMenu = vi.fn();
    const utils = render(
        <PauseOverlay
            open
            onResume={onResume}
            onRestart={onRestart}
            onExitToMenu={onExitToMenu}
            {...overrides}
        />,
    );
    return { ...utils, onResume, onRestart, onExitToMenu };
}

describe('PauseOverlay', () => {
    it('does not render when closed', () => {
        render(
            <PauseOverlay
                open={false}
                onResume={vi.fn()}
                onRestart={vi.fn()}
                onExitToMenu={vi.fn()}
            />,
        );

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows the dialog with all controls when open', () => {
        renderOverlay();

        expect(screen.getByRole('dialog', { name: 'Пауза' })).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Общий звук' })).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: /^Музыка/ })).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: /^Эффекты/ })).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: /^Спокойный HUD/ })).toBeInTheDocument();
        expect(screen.getByRole('radiogroup', { name: 'Язык' })).toBeInTheDocument();
        expect(screen.getByRole('radiogroup', { name: 'Сложность' })).toBeInTheDocument();
    });

    it('calls onResume when clicking «Продолжить»', async () => {
        const user = userEvent.setup();
        const { onResume } = renderOverlay();

        await user.click(screen.getByRole('button', { name: 'Продолжить' }));

        expect(onResume).toHaveBeenCalledTimes(1);
    });

    it('calls onResume when clicking the close icon button', async () => {
        const user = userEvent.setup();
        const { onResume } = renderOverlay();

        await user.click(screen.getByRole('button', { name: 'Закрыть' }));

        expect(onResume).toHaveBeenCalledTimes(1);
    });

    it('calls onResume on Escape', async () => {
        const user = userEvent.setup();
        const { onResume } = renderOverlay();

        await user.keyboard('{Escape}');

        expect(onResume).toHaveBeenCalledTimes(1);
    });

    it('calls onRestart when clicking «Начать заново»', async () => {
        const user = userEvent.setup();
        const { onRestart } = renderOverlay();

        await user.click(screen.getByRole('button', { name: 'Начать заново' }));

        expect(onRestart).toHaveBeenCalledTimes(1);
    });

    it('calls onExitToMenu when clicking «Выйти в меню»', async () => {
        const user = userEvent.setup();
        const { onExitToMenu } = renderOverlay();

        await user.click(screen.getByRole('button', { name: 'Выйти в меню' }));

        expect(onExitToMenu).toHaveBeenCalledTimes(1);
    });

    it('toggles the general sound switch', async () => {
        const user = userEvent.setup();
        renderOverlay();

        const soundSwitch = screen.getByRole('switch', { name: 'Общий звук' });
        expect(soundSwitch).toHaveAttribute('aria-checked', 'true');

        await user.click(soundSwitch);

        expect(soundSwitch).toHaveAttribute('aria-checked', 'false');
    });

    it('disables music and fx switches when the general sound is off', async () => {
        const user = userEvent.setup();
        renderOverlay();

        await user.click(screen.getByRole('switch', { name: 'Общий звук' }));

        expect(screen.getByRole('switch', { name: /^Музыка/ })).toBeDisabled();
        expect(screen.getByRole('switch', { name: /^Эффекты/ })).toBeDisabled();
    });

    it('sets data-intensity=calm on the theme scope when the calm HUD switch is on', async () => {
        const user = userEvent.setup();
        const { container } = renderOverlay();

        expect(container.querySelector('[data-intensity="calm"]')).toBeNull();

        await user.click(screen.getByRole('switch', { name: /^Спокойный HUD/ }));

        expect(container.querySelector('[data-intensity="calm"]')).not.toBeNull();
    });

    it('switches the selected language', async () => {
        const user = userEvent.setup();
        renderOverlay();

        const enOption = screen.getByRole('radio', { name: 'EN' });
        expect(enOption).toHaveAttribute('aria-checked', 'false');

        await user.click(enOption);

        expect(enOption).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'RU' })).toHaveAttribute('aria-checked', 'false');
    });

    it('switches the selected difficulty', async () => {
        const user = userEvent.setup();
        renderOverlay();

        const hardOption = screen.getByRole('radio', { name: 'Терминатор' });
        expect(hardOption).toHaveAttribute('aria-checked', 'false');

        await user.click(hardOption);

        expect(hardOption).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'Стрелок' })).toHaveAttribute(
            'aria-checked',
            'false',
        );
    });
});
