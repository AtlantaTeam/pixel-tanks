import { render } from '@testing-library/react';
import { KeyboardSchemeHint } from './keyboard-scheme-hint';

describe('KeyboardSchemeHint', () => {
    it('renders angle and power controls hint', () => {
        const { getByText } = render(<KeyboardSchemeHint />);

        expect(getByText(/угол\/мощность/)).toBeInTheDocument();
    });

    it('renders Ctrl key hint', () => {
        const { getByText } = render(<KeyboardSchemeHint />);

        expect(getByText(/Ctrl/)).toBeInTheDocument();
    });

    it('renders movement and weapon hint', () => {
        const { getByText } = render(<KeyboardSchemeHint />);

        expect(getByText(/перемещение\/оружие/)).toBeInTheDocument();
    });

    it('renders fire action hint', () => {
        const { getByText } = render(<KeyboardSchemeHint />);

        expect(getByText(/Enter.*Space|Space.*Enter/)).toBeInTheDocument();
    });

    it('renders with muted text color', () => {
        const { container } = render(<KeyboardSchemeHint />);

        expect(container.querySelector('.text-muted')).toBeInTheDocument();
    });
});
