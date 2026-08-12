import { render, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_WIND, useGameStore } from '@/features/game-engine';
import { BOT_NAME } from '@/shared/config';
import { TopHud } from './top-hud';

describe('TopHud', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('рендерит HP-карточки обеих сторон компактной строкой без переноса', () => {
        useGameStore.setState({ hp: { player: 72, enemy: 38 } });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.getByText('72/100')).toBeInTheDocument();
        expect(mobile.getByText('38/100')).toBeInTheDocument();
        expect(mobile.getByText('Rex Commander')).toBeInTheDocument();
        expect(mobile.getByText(BOT_NAME)).toBeInTheDocument();
    });

    it('пилюля хода показывает «ТВОЙ ХОД», когда ходит игрок', () => {
        useGameStore.setState({ turn: 'player', phase: 'aiming' });
        const { getByTestId } = render(<TopHud />);

        expect(within(getByTestId('top-hud-mobile')).getByText('ТВОЙ ХОД')).toBeInTheDocument();
    });

    it('пилюля хода показывает «ХОД СОПЕРНИКА», когда ходит бот', () => {
        useGameStore.setState({ turn: 'enemy', phase: 'aiming' });
        const { getByTestId } = render(<TopHud />);

        expect(
            within(getByTestId('top-hud-mobile')).getByText('ХОД СОПЕРНИКА'),
        ).toBeInTheDocument();
    });

    it('пилюля хода показывает «ВЫСТРЕЛ» во время полёта снаряда независимо от того, чей был ход', () => {
        useGameStore.setState({ turn: 'player', phase: 'flight' });
        const { getByTestId, rerender } = render(<TopHud />);
        expect(within(getByTestId('top-hud-mobile')).getByText('ВЫСТРЕЛ')).toBeInTheDocument();

        useGameStore.setState({ turn: 'enemy', phase: 'flight' });
        rerender(<TopHud />);
        expect(within(getByTestId('top-hud-mobile')).getByText('ВЫСТРЕЛ')).toBeInTheDocument();
    });

    it('скрывает пилюлю хода после конца боя (handoff «Game over»: индикатора хода быть не может)', () => {
        useGameStore.setState({ turn: 'enemy', phase: 'over' });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.queryByText('ХОД СОПЕРНИКА')).not.toBeInTheDocument();
        expect(mobile.queryByText('ТВОЙ ХОД')).not.toBeInTheDocument();
        expect(mobile.queryByText('ВЫСТРЕЛ')).not.toBeInTheDocument();

        const desktop = within(getByTestId('top-hud-desktop'));
        expect(desktop.queryByText('ХОД СОПЕРНИКА')).not.toBeInTheDocument();
    });

    it('телеметрия приглушается и угол помечается «заморожен» на ходе бота', () => {
        useGameStore.setState({ turn: 'enemy' });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.getByText('Угол · заморожен')).toBeInTheDocument();
        expect(
            mobile.getByText('Твои числа заморожены до конца хода соперника'),
        ).toBeInTheDocument();
    });

    it('не помечает угол замороженным и не гасит телеметрию на ходе игрока', () => {
        useGameStore.setState({ turn: 'player' });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.getByText('Угол')).toBeInTheDocument();
        expect(
            mobile.queryByText('Твои числа заморожены до конца хода соперника'),
        ).not.toBeInTheDocument();
    });

    it('до первого выстрела ветер показывает только грубые пипы, без точного числа', () => {
        useGameStore.setState({ wind: MAX_WIND, windRevealed: false });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.queryByText('3')).not.toBeInTheDocument();
        expect(mobile.getByRole('img', { name: /грубая сила ветра/ })).toBeInTheDocument();
    });

    it('после раскрытия ветер показывает точное число', () => {
        useGameStore.setState({ wind: MAX_WIND, windRevealed: true });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        expect(mobile.getByText('3')).toBeInTheDocument();
        expect(mobile.queryByRole('img', { name: /грубая сила ветра/ })).not.toBeInTheDocument();
    });

    it('пипы снарядов и ходов красятся фиксированными токенами, не темой хода соперника', () => {
        useGameStore.setState({ turn: 'enemy', weapons: [{ id: 0, name: 'Снаряд' }] });
        const { getByTestId } = render(<TopHud />);

        const mobile = within(getByTestId('top-hud-mobile'));
        const ammoPip = mobile
            .getAllByLabelText(/снарядов/)[0]
            .querySelector('[data-testid="pip"]');
        expect((ammoPip as HTMLElement).style.background).toBe('var(--color-accent)');
    });

    it('значение угла красится фиксированным accent-токеном (Tailwind text-accent) независимо от хода', () => {
        useGameStore.setState({ turn: 'enemy' });
        const { getByTestId } = render(<TopHud />);

        const mobile = getByTestId('top-hud-mobile');
        const angleValue = mobile.querySelector('.text-accent');
        expect(angleValue).toBeInTheDocument();
    });

    it('дизейблит кнопки ± угла/силы, пока в полёте свой снаряд (turn=player, phase=flight)', () => {
        useGameStore.setState({ turn: 'player', phase: 'flight' });
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        expect(mobile.getByRole('button', { name: 'Угол больше' })).toBeDisabled();
        expect(mobile.getByRole('button', { name: 'Сила больше' })).toBeDisabled();
    });

    it('меняет угол по кнопкам ± на мобилке', () => {
        useGameStore.setState({ angle: 0, turn: 'player' });
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        mobile.getByRole('button', { name: 'Угол больше' }).click();

        expect(useGameStore.getState().angle).toBeCloseTo(-Math.PI / 180);
    });

    it('дизейблит кнопки ± угла/силы на ходе бота', () => {
        useGameStore.setState({ turn: 'enemy' });
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        expect(mobile.getByRole('button', { name: 'Угол больше' })).toBeDisabled();
        expect(mobile.getByRole('button', { name: 'Сила больше' })).toBeDisabled();
    });

    it('кнопка паузы 44px зовёт onPauseClick', () => {
        const onPauseClick = vi.fn();
        const { getByTestId } = render(<TopHud onPauseClick={onPauseClick} />);
        const mobile = within(getByTestId('top-hud-mobile'));

        const pauseButton = mobile.getByRole('button', { name: 'Пауза' });
        expect(pauseButton).toHaveClass('size-11');
        pauseButton.click();

        expect(onPauseClick).toHaveBeenCalledTimes(1);
    });

    it('кнопка mute переключает звук', () => {
        const { getByTestId } = render(<TopHud />);
        const mobile = within(getByTestId('top-hud-mobile'));

        expect(mobile.getByRole('button', { name: 'Выключить звук' })).toBeInTheDocument();
    });

    it('не показывает кнопки ± угла/силы в планшетной/десктопной раскладке (handoff: доводка только на тач-мобилке)', () => {
        const { getByTestId } = render(<TopHud />);
        const desktop = within(getByTestId('top-hud-desktop'));

        expect(desktop.queryByRole('button', { name: 'Угол больше' })).not.toBeInTheDocument();
        expect(desktop.queryByRole('button', { name: 'Сила больше' })).not.toBeInTheDocument();
    });
});
