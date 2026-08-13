import { render } from '@testing-library/react';
import { useGameStore } from '@/features/game-engine';
import { EWeaponKind } from '@/shared/model';
import { AmmoEmptyToast } from './ammo-empty-toast';

function setWeapons(count: number) {
    const weapons = Array.from({ length: count }, (_, id) => ({
        id,
        name: 'Фугас',
        kind: EWeaponKind.HighExplosive,
    }));
    useGameStore.setState({
        weapons,
        selectedWeapon: weapons[0] ?? null,
        turn: 'player',
        phase: 'aiming',
        moves: 4,
    });
}

describe('AmmoEmptyToast (issue #448 — собственный слой поверх арены)', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('монтируется на своём ходе без снарядов', () => {
        setWeapons(0);
        const { getByRole } = render(<AmmoEmptyToast />);

        expect(getByRole('status')).toHaveTextContent('Патроны кончились');
    });

    it('размонтируется, как только снаряды появляются', () => {
        setWeapons(0);
        const { queryByRole, rerender } = render(<AmmoEmptyToast />);
        expect(queryByRole('status')).toBeInTheDocument();

        setWeapons(3);
        rerender(<AmmoEmptyToast />);

        expect(queryByRole('status')).not.toBeInTheDocument();
    });

    it('не рендерится, пока есть снаряды', () => {
        setWeapons(3);
        const { queryByRole } = render(<AmmoEmptyToast />);

        expect(queryByRole('status')).not.toBeInTheDocument();
    });

    it('не рендерится на ходе соперника (там уже лок)', () => {
        setWeapons(0);
        useGameStore.setState({ turn: 'enemy' });
        const { queryByRole } = render(<AmmoEmptyToast />);

        expect(queryByRole('status')).not.toBeInTheDocument();
    });

    it('не рендерится во время полёта снаряда', () => {
        setWeapons(0);
        useGameStore.setState({ phase: 'flight' });
        const { queryByRole } = render(<AmmoEmptyToast />);

        expect(queryByRole('status')).not.toBeInTheDocument();
    });

    it('не перехватывает нажатия — обёртка pointer-events-none', () => {
        setWeapons(0);
        const { getByRole } = render(<AmmoEmptyToast />);

        expect(getByRole('status').parentElement).toHaveClass('pointer-events-none');
    });
});
