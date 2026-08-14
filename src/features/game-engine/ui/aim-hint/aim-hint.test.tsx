import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AimHint, AimHintAnnouncer } from './aim-hint';

describe('AimHint (разовая подсказка прицеливания #565)', () => {
    it('скрыта — ничего не рендерит', () => {
        const { container } = render(<AimHint visible={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('видима — рисует визуальную плашку под aria-hidden', () => {
        render(<AimHint visible />);
        expect(screen.getByTestId('aim-hint')).toHaveAttribute('aria-hidden');
    });
});

describe('AimHintAnnouncer (факт для скринридера, ревью #574)', () => {
    it('live-region смонтирован всегда и пуст, пока подсказка не активна', () => {
        // Ключ к анонсу: узел обязан существовать в дереве ДО появления текста —
        // скринридеры молчат на ПОЯВЛЕНИИ узла, озвучивают смену содержимого уже
        // смонтированного региона. Поэтому неактивный announcer — не null, а пустой.
        render(<AimHintAnnouncer active={false} />);
        const live = screen.getByTestId('aim-hint-live');
        expect(live).not.toHaveAttribute('aria-hidden');
        expect(live).toHaveClass('sr-only');
        expect(live).toHaveAttribute('aria-live', 'polite');
        expect(live.textContent).toBe('');
    });

    it('активна — несёт факт «направление, а не точка падения» в тот же узел', () => {
        render(<AimHintAnnouncer active />);
        const live = screen.getByTestId('aim-hint-live');
        expect(live.textContent).toMatch(/направлени/i);
        expect(live.textContent).toMatch(/точку падения/i);
    });
});
