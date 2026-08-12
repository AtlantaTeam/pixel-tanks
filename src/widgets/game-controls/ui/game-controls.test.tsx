import { createRef } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TGameCanvasHandle } from '@/features/game-engine';
import { useGameStore } from '@/features/game-engine';
import { GameControls } from './game-controls';

function renderDeck() {
    const gameApiRef = createRef<TGameCanvasHandle>();
    (gameApiRef as { current: TGameCanvasHandle }).current = {
        fire: vi.fn(),
        moveLeft: vi.fn(),
        moveRight: vi.fn(),
    };
    const utils = render(<GameControls gameApiRef={gameApiRef} />);
    return { ...utils, gameApiRef };
}

function setWeapons(count: number) {
    const weapons = Array.from({ length: count }, (_, id) => ({ id, name: 'Снаряд' }));
    useGameStore.setState({
        weapons,
        selectedWeapon: weapons[0] ?? null,
        turn: 'player',
        phase: 'aiming',
        moves: 4,
    });
}

describe('GameControls (палуба)', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('не рендерит легаси нативный select оружия', () => {
        setWeapons(5);
        const { queryByRole } = renderDeck();

        expect(queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('показывает боезапас выбранного оружия в селекторе (48px стрелки)', () => {
        setWeapons(5);
        const { getAllByLabelText } = renderDeck();

        const arrows = getAllByLabelText('Следующее оружие');
        expect(arrows[0]).toHaveClass('size-12');
    });

    it('кнопка ОГОНЬ подписана конкретными числами выстрела', () => {
        setWeapons(5);
        useGameStore.setState({ angle: 0, power: 7 });
        const { getAllByRole } = renderDeck();

        const fireButtons = getAllByRole('button', { name: /Огонь/ });
        expect(fireButtons[0]).toHaveTextContent(/007/);
    });

    it('ОГОНЬ дизейблится и подписан «нет снарядов», когда патроны кончились', () => {
        setWeapons(0);
        const { getAllByRole } = renderDeck();

        const fireButtons = getAllByRole('button', { name: /Огонь/ });
        for (const button of fireButtons) {
            expect(button).toBeDisabled();
            expect(button).toHaveTextContent('нет снарядов');
        }
    });

    it('манёвр остаётся активным при нуле снарядов, пока есть ходы', () => {
        setWeapons(0);
        useGameStore.setState({ moves: 2 });
        const { getAllByLabelText } = renderDeck();

        for (const button of getAllByLabelText('Сдвинуть влево')) {
            expect(button).not.toBeDisabled();
        }
        for (const button of getAllByLabelText('Сдвинуть вправо')) {
            expect(button).not.toBeDisabled();
        }
    });

    it('манёвр дизейблится, когда ходы исчерпаны', () => {
        setWeapons(3);
        useGameStore.setState({ moves: 0 });
        const { getAllByLabelText } = renderDeck();

        for (const button of getAllByLabelText('Сдвинуть влево')) {
            expect(button).toBeDisabled();
        }
    });

    it('клик по манёвру зовёт moveLeft/moveRight движка через gameApiRef', async () => {
        const user = userEvent.setup();
        setWeapons(3);
        const { getAllByLabelText, gameApiRef } = renderDeck();

        await user.click(getAllByLabelText('Сдвинуть вправо')[0]);

        expect(gameApiRef.current?.moveRight).toHaveBeenCalledTimes(1);
    });

    it('клик по ОГОНЬ зовёт fire() движка через gameApiRef', async () => {
        const user = userEvent.setup();
        setWeapons(3);
        const { getAllByRole, gameApiRef } = renderDeck();

        await user.click(getAllByRole('button', { name: /Огонь/ })[0]);

        expect(gameApiRef.current?.fire).toHaveBeenCalledTimes(1);
    });

    it('деку не показывает клавиатурную подсказку до десктопного брейкпоинта (только hidden-класс, без media-раскрытия)', () => {
        setWeapons(3);
        const { getByText } = renderDeck();

        // Подсказка присутствует только в десктопном составе (`xl:flex`) — она
        // всегда одна на дерево (не дублируется в мобильном/планшетном составах).
        expect(
            getByText('Space выстрел').closest('[data-testid="game-deck-desktop"]'),
        ).not.toBeNull();
    });

    it('на ходе соперника ОГОНЬ и манёвр недоступны', () => {
        setWeapons(3);
        useGameStore.setState({ turn: 'enemy' });
        const { getAllByRole, getAllByLabelText } = renderDeck();

        for (const button of getAllByRole('button', { name: /Огонь/ })) {
            expect(button).toBeDisabled();
        }
        for (const button of getAllByLabelText('Сдвинуть влево')) {
            expect(button).toBeDisabled();
        }
    });
});
