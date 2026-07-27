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

    it('именует группу через aria-labelledby, без дублирующего aria-label, когда задан labelledBy', () => {
        render(
            <>
                <span id="seg-heading">Период</span>
                <SegmentedControl
                    label="Период"
                    labelledBy="seg-heading"
                    options={PERIOD_OPTIONS}
                    value="day"
                    onChange={() => {}}
                />
            </>,
        );

        const group = screen.getByRole('radiogroup', { name: 'Период' });
        expect(group).toHaveAttribute('aria-labelledby', 'seg-heading');
        expect(group).not.toHaveAttribute('aria-label');
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

    it('двигает выбор стрелкой вниз как вправо (вертикальная навигация)', async () => {
        const user = userEvent.setup();
        render(<ControlledSegmentedControl options={DIFFICULTY_OPTIONS} initialValue="rookie" />);

        screen.getByRole('radio', { name: 'Новобранец' }).focus();
        await user.keyboard('{ArrowDown}');

        const shooter = screen.getByRole('radio', { name: 'Стрелок' });
        expect(shooter).toHaveAttribute('aria-checked', 'true');
        expect(shooter).toHaveFocus();
    });

    it('двигает выбор стрелкой вверх как влево (вертикальная навигация)', async () => {
        const user = userEvent.setup();
        render(<ControlledSegmentedControl options={DIFFICULTY_OPTIONS} initialValue="shooter" />);

        screen.getByRole('radio', { name: 'Стрелок' }).focus();
        await user.keyboard('{ArrowUp}');

        const rookie = screen.getByRole('radio', { name: 'Новобранец' });
        expect(rookie).toHaveAttribute('aria-checked', 'true');
        expect(rookie).toHaveFocus();
    });

    it('делает первый сегмент tabbable, когда value не совпал ни с одной опцией', () => {
        render(
            <SegmentedControl
                label="Период"
                options={PERIOD_OPTIONS}
                value={'' as 'day' | 'all'}
                onChange={() => {}}
            />,
        );

        expect(screen.getByRole('radio', { name: 'День' })).toHaveAttribute('tabIndex', '0');
        expect(screen.getByRole('radio', { name: 'Всё время' })).toHaveAttribute('tabIndex', '-1');
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

    it('показывает accent-outline на фокусе сегмента', () => {
        render(
            <SegmentedControl
                label="Период"
                options={PERIOD_OPTIONS}
                value="day"
                onChange={() => {}}
            />,
        );

        const segment = screen.getByRole('radio', { name: 'День' });
        expect(segment.className).toMatch(/focus-visible:outline-\[var\(--accent\)\]/);
    });
});
