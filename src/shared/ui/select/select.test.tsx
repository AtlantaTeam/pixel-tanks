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
});
