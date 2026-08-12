import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeaponSelector } from './weapon-selector';
import { DEMO_WEAPONS as WEAPONS } from './weapon-selector.fixtures';

describe('WeaponSelector', () => {
    it('renders the selected weapon name and ammo count', () => {
        const { getByText } = render(
            <WeaponSelector
                weapons={WEAPONS}
                selectedIndex={0}
                onPrev={() => {}}
                onNext={() => {}}
            />,
        );

        expect(getByText('Фугас')).toBeInTheDocument();
        expect(getByText('×12')).toBeInTheDocument();
    });

    it('switches displayed weapon when selectedIndex changes', () => {
        const { getByText, rerender } = render(
            <WeaponSelector
                weapons={WEAPONS}
                selectedIndex={0}
                onPrev={() => {}}
                onNext={() => {}}
            />,
        );

        rerender(
            <WeaponSelector
                weapons={WEAPONS}
                selectedIndex={2}
                onPrev={() => {}}
                onNext={() => {}}
            />,
        );

        expect(getByText('Кластер')).toBeInTheDocument();
        expect(getByText('×6')).toBeInTheDocument();
    });

    it('calls onPrev when the left arrow is clicked', async () => {
        const user = userEvent.setup();
        const onPrev = vi.fn();
        const { getByLabelText } = render(
            <WeaponSelector
                weapons={WEAPONS}
                selectedIndex={1}
                onPrev={onPrev}
                onNext={() => {}}
            />,
        );

        await user.click(getByLabelText('Предыдущее оружие'));

        expect(onPrev).toHaveBeenCalledTimes(1);
    });

    it('calls onNext when the right arrow is clicked', async () => {
        const user = userEvent.setup();
        const onNext = vi.fn();
        const { getByLabelText } = render(
            <WeaponSelector
                weapons={WEAPONS}
                selectedIndex={1}
                onPrev={() => {}}
                onNext={onNext}
            />,
        );

        await user.click(getByLabelText('Следующее оружие'));

        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('renders the weapon icon', () => {
        const { container } = render(
            <WeaponSelector
                weapons={WEAPONS}
                selectedIndex={0}
                onPrev={() => {}}
                onNext={() => {}}
            />,
        );

        expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders nothing for the current weapon slot when the index is out of range', () => {
        const { queryByText } = render(
            <WeaponSelector
                weapons={WEAPONS}
                selectedIndex={99}
                onPrev={() => {}}
                onNext={() => {}}
            />,
        );

        expect(queryByText('Фугас')).not.toBeInTheDocument();
    });

    it('глушит панель тихого фолбэка (пустой список), а не рисует активным слотом', () => {
        // В живой игре кончившийся боезапас приходит пустым списком (weapon ===
        // undefined), а не слотом с ammo===0. Пустая панель обязана читаться как
        // «нечем стрелять» (муто-рамка), а не светиться --accent как заряженный.
        const { getByTestId } = render(
            <WeaponSelector weapons={[]} selectedIndex={0} onPrev={() => {}} onNext={() => {}} />,
        );

        expect(getByTestId('weapon-ammo')).toHaveClass('opacity-55');
    });

    it('exposes ammo count as a data attribute for e2e reads', () => {
        const { getByTestId } = render(
            <WeaponSelector
                weapons={WEAPONS}
                selectedIndex={1}
                onPrev={() => {}}
                onNext={() => {}}
            />,
        );

        expect(getByTestId('weapon-ammo')).toHaveAttribute('data-ammo-count', '4');
    });

    describe('пустой боезапас (ammo === 0)', () => {
        const EMPTY_WEAPONS = [{ name: 'Фугас', icon: 'wpn-фугас' as const, ammo: 0 }];

        it('красит счётчик патронов в danger', () => {
            const { getByText } = render(
                <WeaponSelector
                    weapons={EMPTY_WEAPONS}
                    selectedIndex={0}
                    onPrev={() => {}}
                    onNext={() => {}}
                />,
            );

            expect(getByText('×0')).toHaveClass('text-danger');
        });

        it('приглушает панель (opacity)', () => {
            const { getByTestId } = render(
                <WeaponSelector
                    weapons={EMPTY_WEAPONS}
                    selectedIndex={0}
                    onPrev={() => {}}
                    onNext={() => {}}
                />,
            );

            expect(getByTestId('weapon-ammo')).toHaveClass('opacity-55');
        });
    });

    it('accepts a custom className', () => {
        const { container } = render(
            <WeaponSelector
                weapons={WEAPONS}
                selectedIndex={0}
                onPrev={() => {}}
                onNext={() => {}}
                className="custom-weapon-selector"
            />,
        );

        expect((container.firstChild as HTMLElement).className).toContain('custom-weapon-selector');
    });
});
