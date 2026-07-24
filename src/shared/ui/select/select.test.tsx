import { render } from '@testing-library/react';
import { Select } from './select';

describe('Select', () => {
    it('renders with a 44px min-height touch target', () => {
        const { getByRole } = render(
            <Select id="weapon" label="Оружие">
                <option value="1">Снаряд #1</option>
            </Select>,
        );

        expect(getByRole('combobox')).toHaveClass('min-h-11');
    });

    it('renders from semantic token classes, not hardcoded colors', () => {
        const { getByRole } = render(
            <Select id="weapon" label="Оружие">
                <option value="1">Снаряд #1</option>
            </Select>,
        );

        const select = getByRole('combobox');
        expect(select.className).toMatch(/\bbg-surface\b/);
        expect(select.className).toMatch(/\bborder-border-strong\b/);
        expect(select.className).toMatch(/\btext-text\b/);
        expect(select.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });
});
