import { render } from '@testing-library/react';
import { KeyboardSchemeHint } from './keyboard-scheme-hint';

describe('KeyboardSchemeHint', () => {
    it('renders angle hint', () => {
        const { getByText } = render(<KeyboardSchemeHint />);

        expect(getByText('← → угол')).toBeInTheDocument();
    });

    it('renders power hint', () => {
        const { getByText } = render(<KeyboardSchemeHint />);

        expect(getByText('↑ ↓ сила')).toBeInTheDocument();
    });

    it('renders maneuver hint with Ctrl', () => {
        const { getByText } = render(<KeyboardSchemeHint />);

        expect(getByText(/Ctrl.*манёвр/)).toBeInTheDocument();
    });

    it('renders fire hint', () => {
        const { getByText } = render(<KeyboardSchemeHint />);

        expect(getByText(/Space.*выстрел/)).toBeInTheDocument();
    });

    it('renders with muted text color', () => {
        const { container } = render(<KeyboardSchemeHint />);

        expect(container.querySelector('.text-text-dim')).toBeInTheDocument();
    });

    // Handoff «Клавиатурная подсказка»: гейт видимости — CSS media query, а не JS-
    // детект устройства. Юнит-тест не умеет вычислить фактический @media на jsdom,
    // поэтому проверяем контракт классов: `hidden` по умолчанию + media-вариант,
    // раскрывающий её только при hover:hover И pointer:fine.
    it('скрыта по умолчанию и раскрывается только по (hover:hover) и (pointer:fine)', () => {
        const { container } = render(<KeyboardSchemeHint />);
        const root = container.firstElementChild as HTMLElement;

        expect(root).toHaveClass('hidden');
        expect(root.className).toContain('[@media(hover:hover)_and_(pointer:fine)]:flex');
    });
});
