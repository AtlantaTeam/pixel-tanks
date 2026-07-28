import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { Select } from './select';

function renderWeaponSelect(props: Partial<ComponentProps<typeof Select>> = {}) {
    return render(
        <Select id="weapon" label="Оружие" {...props}>
            <option value="1">Снаряд</option>
            <option value="2">Мощный</option>
            <option value="3">Кластер</option>
        </Select>,
    );
}

describe('Select', () => {
    it('рендерит триггер с 44px touch target', () => {
        renderWeaponSelect();

        expect(screen.getByRole('button', { name: /Оружие/ })).toHaveClass('min-h-11');
    });

    it('красит триггер только семантическими токенами, без хардкода цвета', () => {
        renderWeaponSelect();

        const trigger = screen.getByRole('button', { name: /Оружие/ });
        expect(trigger.className).toMatch(/\bbg-surface\b/);
        expect(trigger.className).toMatch(/\bborder-border-strong\b/);
        expect(trigger.className).toMatch(/\btext-text\b/);
        expect(trigger.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('отражает число опций в data-option-count триггера, не раскрывая попап', () => {
        renderWeaponSelect();

        // Атрибут держит состав закрытым — на него опираются e2e бои, считая
        // оставшееся оружие без открытия списка (нативных <option> в DOM больше нет).
        expect(screen.getByRole('button', { name: /Оружие/ })).toHaveAttribute(
            'data-option-count',
            '3',
        );
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('не рендерит попап, пока закрыт', () => {
        renderWeaponSelect();

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('открывает попап по клику на триггер и закрывает повторным кликом', async () => {
        const user = userEvent.setup();
        renderWeaponSelect();

        await user.click(screen.getByRole('button', { name: /Оружие/ }));
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(screen.getAllByRole('option')).toHaveLength(3);

        await user.click(screen.getByRole('button', { name: /Оружие/ }));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('открывается по Enter и переводит фокус в список', async () => {
        const user = userEvent.setup();
        renderWeaponSelect();

        screen.getByRole('button', { name: /Оружие/ }).focus();
        await user.keyboard('{Enter}');

        expect(screen.getByRole('listbox')).toHaveFocus();
    });

    it('открывается по стрелке вниз', async () => {
        const user = userEvent.setup();
        renderWeaponSelect();

        screen.getByRole('button', { name: /Оружие/ }).focus();
        await user.keyboard('{ArrowDown}');

        expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('выбирает опцию кликом мыши, вызывает onValueChange и закрывает попап', async () => {
        const user = userEvent.setup();
        const onValueChange = vi.fn();
        renderWeaponSelect({ value: '1', onValueChange });

        await user.click(screen.getByRole('button', { name: /Оружие/ }));
        await user.click(screen.getByRole('option', { name: 'Мощный' }));

        expect(onValueChange).toHaveBeenCalledWith('2');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('выбирает опцию с клавиатуры (стрелки + Enter) и возвращает фокус на триггер', async () => {
        const user = userEvent.setup();
        const onValueChange = vi.fn();
        renderWeaponSelect({ value: '1', onValueChange });

        const trigger = screen.getByRole('button', { name: /Оружие/ });
        trigger.focus();
        await user.keyboard('{ArrowDown}');
        await user.keyboard('{ArrowDown}');
        await user.keyboard('{Enter}');

        expect(onValueChange).toHaveBeenCalledWith('2');
        expect(trigger).toHaveFocus();
    });

    it('закрывается по Esc без выбора и возвращает фокус на триггер', async () => {
        const user = userEvent.setup();
        const onValueChange = vi.fn();
        renderWeaponSelect({ value: '1', onValueChange });

        const trigger = screen.getByRole('button', { name: /Оружие/ });
        trigger.focus();
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(onValueChange).not.toHaveBeenCalled();
        expect(trigger).toHaveFocus();
    });

    it('переходит к опции по первой букве (type-ahead)', async () => {
        const user = userEvent.setup();
        const onValueChange = vi.fn();
        renderWeaponSelect({ value: '1', onValueChange });

        screen.getByRole('button', { name: /Оружие/ }).focus();
        await user.keyboard('{ArrowDown}');
        await user.keyboard('к');
        await user.keyboard('{Enter}');

        expect(onValueChange).toHaveBeenCalledWith('3');
    });

    it('выставляет ARIA-атрибуты триггера и попапа', async () => {
        const user = userEvent.setup();
        renderWeaponSelect({ value: '2' });

        const trigger = screen.getByRole('button', { name: /Оружие/ });
        expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await user.click(trigger);

        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const listbox = screen.getByRole('listbox');
        expect(listbox).toHaveAttribute('aria-activedescendant');
        expect(screen.getByRole('option', { name: 'Мощный' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(screen.getByRole('option', { name: 'Снаряд' })).toHaveAttribute(
            'aria-selected',
            'false',
        );
    });

    it('не открывается, когда disabled', async () => {
        const user = userEvent.setup();
        renderWeaponSelect({ disabled: true });

        const trigger = screen.getByRole('button', { name: /Оружие/ });
        expect(trigger).toBeDisabled();

        await user.click(trigger);

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('пропускает disabled-опцию при навигации стрелками', async () => {
        const user = userEvent.setup();
        const onValueChange = vi.fn();
        render(
            <Select id="weapon" label="Оружие" value="1" onValueChange={onValueChange}>
                <option value="1">Снаряд</option>
                <option value="2" disabled>
                    Мощный
                </option>
                <option value="3">Кластер</option>
            </Select>,
        );

        screen.getByRole('button', { name: /Оружие/ }).focus();
        await user.keyboard('{ArrowDown}');
        await user.keyboard('{ArrowDown}');
        await user.keyboard('{Enter}');

        expect(onValueChange).toHaveBeenCalledWith('3');
    });

    it('без value выбирает первую опцию по умолчанию (неуправляемый режим)', () => {
        renderWeaponSelect();

        expect(screen.getByRole('button', { name: /Оружие/ })).toHaveTextContent('Снаряд');
    });

    it('собирает текст опции из нескольких children (как в game-controls: {name} #{id})', () => {
        const items = [
            { id: 1, name: 'Снаряд' },
            { id: 2, name: 'Мощный' },
        ];
        render(
            <Select id="weapon" label="Оружие" value="2">
                {items.map((item) => (
                    <option key={item.id} value={item.id}>
                        {item.name} #{item.id}
                    </option>
                ))}
            </Select>,
        );

        expect(screen.getByRole('button', { name: /Оружие/ })).toHaveTextContent('Мощный #2');
    });

    it('включает выбранное значение в accessible name триггера (подпись + значение)', () => {
        renderWeaponSelect({ value: '2' });

        // Скринридер должен объявить и подпись, и текущий выбор — не только «Оружие».
        expect(screen.getByRole('button', { name: /Оружие.*Мощный/ })).toBeInTheDocument();
    });

    it('показывает placeholder, когда значение не сматчено ни с одной опцией', () => {
        render(
            <Select id="weapon" label="Оружие" value="" placeholder="Выберите оружие">
                <option value="1">Снаряд</option>
                <option value="2">Мощный</option>
            </Select>,
        );

        expect(screen.getByRole('button', { name: /Оружие/ })).toHaveTextContent('Выберите оружие');
    });

    it('не открывается, когда все опции disabled и ничего не выбрано', async () => {
        const user = userEvent.setup();
        render(
            <Select id="weapon" label="Оружие" value="">
                <option value="1" disabled>
                    Снаряд
                </option>
                <option value="2" disabled>
                    Мощный
                </option>
            </Select>,
        );

        await user.click(screen.getByRole('button', { name: /Оружие/ }));

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
});
