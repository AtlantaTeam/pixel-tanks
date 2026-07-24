import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SegmentedControl, type TSegmentedControlOption } from './segmented-control';

const PERIOD_OPTIONS: TSegmentedControlOption<'day' | 'all'>[] = [
    { value: 'day', label: 'День' },
    { value: 'all', label: 'Всё время' },
];

const DIFFICULTY_OPTIONS: TSegmentedControlOption<'rookie' | 'shooter' | 'terminator'>[] = [
    { value: 'rookie', label: 'Новобранец' },
    { value: 'shooter', label: 'Стрелок' },
    { value: 'terminator', label: 'Терминатор' },
];

function ControlledSegmentedControl({
    options,
    initialValue,
}: {
    options: TSegmentedControlOption<string>[];
    initialValue: string;
}) {
    const [value, setValue] = useState(initialValue);
    return <SegmentedControl label="Период" options={options} value={value} onChange={setValue} />;
}

describe('SegmentedControl', () => {
    it('рендерит группу с доступным именем и опциями как radio', () => {
        render(
            <SegmentedControl
                label="Период"
                options={PERIOD_OPTIONS}
                value="day"
                onChange={() => {}}
            />,
        );

        expect(screen.getByRole('radiogroup', { name: 'Период' })).toBeInTheDocument();
        expect(screen.getAllByRole('radio')).toHaveLength(2);
    });

    it('отмечает активный сегмент через aria-checked', () => {
        render(
            <SegmentedControl
                label="Период"
                options={PERIOD_OPTIONS}
                value="all"
                onChange={() => {}}
            />,
        );

        expect(screen.getByRole('radio', { name: 'День' })).toHaveAttribute(
            'aria-checked',
            'false',
        );
        expect(screen.getByRole('radio', { name: 'Всё время' })).toHaveAttribute(
            'aria-checked',
            'true',
        );
    });

    it('красит активный сегмент семантическими токенами, без хардкода цвета', () => {
        render(
            <SegmentedControl
                label="Период"
                options={PERIOD_OPTIONS}
                value="day"
                onChange={() => {}}
            />,
        );

        const active = screen.getByRole('radio', { name: 'День' });
        expect(active.className).toMatch(/\bbg-\[var\(--accent\)\]/);
        expect(active.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('вызывает onChange с value выбранного сегмента по клику', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <SegmentedControl
                label="Период"
                options={PERIOD_OPTIONS}
                value="day"
                onChange={onChange}
            />,
        );

        await user.click(screen.getByRole('radio', { name: 'Всё время' }));

        expect(onChange).toHaveBeenCalledWith('all');
    });

    it('двигает выбор стрелкой вправо с переносом на первый сегмент', async () => {
        const user = userEvent.setup();
        render(
            <ControlledSegmentedControl options={DIFFICULTY_OPTIONS} initialValue="terminator" />,
        );

        screen.getByRole('radio', { name: 'Терминатор' }).focus();
        await user.keyboard('{ArrowRight}');

        const rookie = screen.getByRole('radio', { name: 'Новобранец' });
        expect(rookie).toHaveAttribute('aria-checked', 'true');
        expect(rookie).toHaveFocus();
    });

    it('двигает выбор стрелкой влево с переносом на последний сегмент', async () => {
        const user = userEvent.setup();
        render(<ControlledSegmentedControl options={DIFFICULTY_OPTIONS} initialValue="rookie" />);

        screen.getByRole('radio', { name: 'Новобранец' }).focus();
        await user.keyboard('{ArrowLeft}');

        const terminator = screen.getByRole('radio', { name: 'Терминатор' });
        expect(terminator).toHaveAttribute('aria-checked', 'true');
        expect(terminator).toHaveFocus();
    });

    it('держит в табе только активный сегмент (roving tabindex)', () => {
        render(
            <SegmentedControl
                label="Сложность"
                options={DIFFICULTY_OPTIONS}
                value="shooter"
                onChange={() => {}}
            />,
        );

        expect(screen.getByRole('radio', { name: 'Новобранец' })).toHaveAttribute('tabIndex', '-1');
        expect(screen.getByRole('radio', { name: 'Стрелок' })).toHaveAttribute('tabIndex', '0');
        expect(screen.getByRole('radio', { name: 'Терминатор' })).toHaveAttribute('tabIndex', '-1');
    });

    it('не падает и не рендерит опций при пустом списке', () => {
        render(<SegmentedControl label="Период" options={[]} value="" onChange={() => {}} />);

        expect(screen.getByRole('radiogroup', { name: 'Период' })).toBeInTheDocument();
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });
});
