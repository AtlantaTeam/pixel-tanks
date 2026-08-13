import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import { mockReducedMotion } from '../../lib/mock-reduced-motion';
import { DamageNumber } from './damage-number';

describe('DamageNumber', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('якорится над точкой попадания (левый/верхний край над центром очага)', () => {
        const { getByText } = render(
            <DamageNumber hit={{ target: 'player', amount: 24, x: 120, y: 80 }} />,
        );

        const wrapper = getByText('-24').parentElement as HTMLElement;
        expect(wrapper.style.left).toBe('120px');
        expect(wrapper.style.top).toBe('80px');
        expect(wrapper).toHaveClass('-translate-x-1/2', '-translate-y-full');
    });

    it('красит число в --color-danger по своему танку (игрок задет)', () => {
        const { getByText } = render(
            <DamageNumber hit={{ target: 'player', amount: 12, x: 0, y: 0 }} />,
        );

        expect(getByText('-12').style.color).toBe('var(--color-danger)');
    });

    it('красит число в --color-warning по боту (задет бот)', () => {
        const { getByText } = render(
            <DamageNumber hit={{ target: 'enemy', amount: 12, x: 0, y: 0 }} />,
        );

        expect(getByText('-12').style.color).toBe('var(--color-warning)');
    });

    it('кегль 20 и подъём/затухание анимацией, гасимой при reduced motion', () => {
        const { getByText } = render(
            <DamageNumber hit={{ target: 'enemy', amount: 5, x: 0, y: 0 }} />,
        );

        const number = getByText('-5');
        expect(number).toHaveClass('text-[20px]');
        expect(number).toHaveClass('animate-damage-rise', 'motion-reduce:animate-none');
    });

    it('исчезает через 400мс (onExpire) при обычном движении', () => {
        const onExpire = vi.fn();
        render(
            <DamageNumber hit={{ target: 'player', amount: 5, x: 0, y: 0 }} onExpire={onExpire} />,
        );

        act(() => {
            vi.advanceTimersByTime(399);
        });
        expect(onExpire).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('живёт неподвижным 800мс при prefers-reduced-motion, не 400мс', () => {
        const restore = mockReducedMotion(true);
        try {
            const onExpire = vi.fn();
            render(
                <DamageNumber
                    hit={{ target: 'player', amount: 5, x: 0, y: 0 }}
                    onExpire={onExpire}
                />,
            );

            act(() => {
                vi.advanceTimersByTime(400);
            });
            expect(onExpire).not.toHaveBeenCalled();

            act(() => {
                vi.advanceTimersByTime(400);
            });
            expect(onExpire).toHaveBeenCalledTimes(1);
        } finally {
            restore();
        }
    });

    it('повторный хит на том же месте перезапускает таймер жизни', () => {
        const onExpire = vi.fn();
        const { rerender } = render(
            <DamageNumber
                hit={{ target: 'player', amount: 5, x: 10, y: 10 }}
                onExpire={onExpire}
            />,
        );

        act(() => {
            vi.advanceTimersByTime(300);
        });
        // Новый объект попадания (та же логическая цифра/координаты, но иной
        // экземпляр) — как повторный удар в то же место в реальном бою.
        rerender(
            <DamageNumber
                hit={{ target: 'player', amount: 5, x: 10, y: 10 }}
                onExpire={onExpire}
            />,
        );
        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(onExpire).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(100);
        });
        expect(onExpire).toHaveBeenCalledTimes(1);
    });
});
