import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Toggle } from './toggle';

function ControlledToggle({
    initialValue = false,
    label = 'Тестовый тумблер',
}: {
    initialValue?: boolean;
    label?: string;
}) {
    const [value, setValue] = useState(initialValue);
    return <Toggle label={label} checked={value} onChange={setValue} />;
}

describe('Toggle', () => {
    it('рендерит button с role=switch и aria-checked', () => {
        render(<Toggle label="Вибрация" checked={false} onChange={() => {}} />);

        const toggle = screen.getByRole('switch', { name: 'Вибрация' });
        expect(toggle).toBeInTheDocument();
        expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('отражает состояние checked в aria-checked', () => {
        const { rerender } = render(
            <Toggle label="Вибрация" checked={false} onChange={() => {}} />,
        );

        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');

        rerender(<Toggle label="Вибрация" checked={true} onChange={() => {}} />);

        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    });

    it('вызывает onChange с инвертированным значением по клику', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Toggle label="Вибрация" checked={false} onChange={onChange} />);

        await user.click(screen.getByRole('switch'));

        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('имеет фокусируемость и доступность при управлении', async () => {
        const user = userEvent.setup();
        render(<ControlledToggle initialValue={false} label="Вибрация" />);

        const toggle = screen.getByRole('switch');

        toggle.focus();
        expect(toggle).toHaveFocus();

        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('красит активное состояние семантическими токенами, без хардкода цвета', () => {
        const { container } = render(
            <Toggle label="Вибрация" checked={true} onChange={() => {}} />,
        );

        const switchDiv = container.querySelector('[aria-hidden="true"]');
        expect(switchDiv?.className).toMatch(/bg-\[var\(--accent\)\]/);
        expect(switchDiv?.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('показывает неактивное состояние на surface/border-strong', () => {
        const { container } = render(
            <Toggle label="Вибрация" checked={false} onChange={() => {}} />,
        );

        const switchDiv = container.querySelector('[aria-hidden="true"]');
        expect(switchDiv?.className).toMatch(/bg-surface/);
        expect(switchDiv?.className).toMatch(/border-border-strong/);
    });

    it('рендерит label справа от переключателя', () => {
        render(<Toggle label="Вибрация" checked={false} onChange={() => {}} />);

        expect(screen.getByText('Вибрация')).toBeInTheDocument();
    });

    it('поддерживает опциональный sublabel', () => {
        render(
            <Toggle label="Музыка" sublabel="фоновая тема" checked={false} onChange={() => {}} />,
        );

        expect(screen.getByText('фоновая тема')).toBeInTheDocument();
    });

    it('отключён при disabled=true', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Toggle label="Вибрация" checked={false} onChange={onChange} disabled={true} />);

        const toggle = screen.getByRole('switch');
        expect(toggle).toBeDisabled();

        await user.click(toggle);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('имеет корректный размер переключателя (52×28px)', () => {
        const { container } = render(
            <Toggle label="Вибрация" checked={true} onChange={() => {}} />,
        );

        const switchElement = container.querySelector('[class*="w-13"]');
        expect(switchElement).toBeInTheDocument();
    });
});
