import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeScope } from './theme-scope';

describe('ThemeScope', () => {
    it('renders children without theme attributes by default', () => {
        render(<ThemeScope data-testid="scope">содержимое</ThemeScope>);
        const scope = screen.getByTestId('scope');

        expect(scope).toHaveTextContent('содержимое');
        expect(scope).not.toHaveAttribute('data-faction');
        expect(scope).not.toHaveAttribute('data-outcome');
        expect(scope).not.toHaveAttribute('data-intensity');
    });

    it('switches theme by setting the faction attribute on the wrapper', () => {
        render(
            <ThemeScope faction="enemy" data-testid="scope">
                враг
            </ThemeScope>,
        );

        expect(screen.getByTestId('scope')).toHaveAttribute('data-faction', 'enemy');
    });

    it('applies outcome and intensity axes together', () => {
        render(
            <ThemeScope outcome="defeat" intensity="calm" data-testid="scope">
                поражение
            </ThemeScope>,
        );
        const scope = screen.getByTestId('scope');

        expect(scope).toHaveAttribute('data-outcome', 'defeat');
        expect(scope).toHaveAttribute('data-intensity', 'calm');
    });

    it('forwards className and other props to the wrapper', () => {
        render(
            <ThemeScope className="w-full" role="group" data-testid="scope">
                x
            </ThemeScope>,
        );
        const scope = screen.getByTestId('scope');

        expect(scope).toHaveClass('w-full');
        expect(scope).toHaveAttribute('role', 'group');
    });
});
