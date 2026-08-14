import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AimHint } from './aim-hint';

describe('AimHint (разовая подсказка прицеливания #565)', () => {
    it('скрыта — ничего не рендерит', () => {
        const { container } = render(<AimHint visible={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('видима — рисует визуальную плашку под aria-hidden', () => {
        render(<AimHint visible />);
        expect(screen.getByTestId('aim-hint')).toHaveAttribute('aria-hidden');
    });

    it('несёт факт «направление, а не точка падения» скринридеру, а не только визуально', () => {
        // Плашка aria-hidden, но единственный носитель факта обязан дойти до AT
        // отдельной sr-only-строкой (ревью #574) — иначе он пропадает под aria-hidden.
        render(<AimHint visible />);
        const live = screen.getByTestId('aim-hint-live');
        expect(live).not.toHaveAttribute('aria-hidden');
        expect(live).toHaveClass('sr-only');
        expect(live.textContent).toMatch(/направлени/i);
        expect(live.textContent).toMatch(/точку падения/i);
    });
});
