import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextInput } from './text-input';

describe('TextInput', () => {
    it('связывает label с полем через htmlFor/id', () => {
        render(<TextInput label="Email" id="email" />);

        expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    it('рендерит из семантических токенов, без хардкода цвета', () => {
        render(<TextInput label="Email" id="email" />);

        const input = screen.getByLabelText('Email');
        expect(input.className).toMatch(/\bbg-surface\b/);
        expect(input.className).toMatch(/\bborder-border-strong\b/);
        expect(input.className).toMatch(/\btext-text\b/);
        expect(input.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('показывает placeholder', () => {
        render(<TextInput label="Email" id="email" placeholder="commander@tanks.io" />);

        expect(screen.getByPlaceholderText('commander@tanks.io')).toBeInTheDocument();
    });

    it('рендерит disabled-состояние без opacity-приёма', () => {
        render(<TextInput label="Промокод" id="promo" disabled />);

        const input = screen.getByLabelText('Промокод');
        expect(input).toBeDisabled();
        expect(input.className).toMatch(/\bdisabled:bg-muted\b/);
        expect(input.className).not.toMatch(/disabled:opacity/);
    });

    it('показывает сообщение об ошибке и связывает его с полем через aria-describedby', () => {
        render(<TextInput label="Email" id="email" error="Неверный формат email" />);

        const input = screen.getByLabelText('Email');
        expect(input).toHaveAttribute('aria-invalid', 'true');
        const message = screen.getByRole('alert');
        expect(message).toHaveTextContent('Неверный формат email');
        expect(input.getAttribute('aria-describedby')).toBe(message.id);
    });

    it('красит поле в danger-токены при ошибке', () => {
        render(<TextInput label="Email" id="email" error="Неверный формат email" />);

        expect(screen.getByLabelText('Email').className).toMatch(/\bborder-danger\b/);
    });

    it('по умолчанию скрывает пароль и показывает кнопку-переключатель', () => {
        render(
            <TextInput label="Пароль" id="password" type="password" defaultValue="tankLord42" />,
        );

        expect(screen.getByLabelText('Пароль')).toHaveAttribute('type', 'password');
        expect(screen.getByRole('button', { name: 'Показать пароль' })).toBeInTheDocument();
    });

    it('переключает видимость пароля по клику на кнопку', async () => {
        const user = userEvent.setup();
        render(
            <TextInput label="Пароль" id="password" type="password" defaultValue="tankLord42" />,
        );

        await user.click(screen.getByRole('button', { name: 'Показать пароль' }));

        expect(screen.getByLabelText('Пароль')).toHaveAttribute('type', 'text');
        expect(screen.getByRole('button', { name: 'Скрыть пароль' })).toBeInTheDocument();
    });

    it('не рендерит кнопку-переключатель для обычного текстового поля', () => {
        render(<TextInput label="Email" id="email" />);

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('отключает кнопку-переключатель пароля вместе с полем', () => {
        render(<TextInput label="Пароль" id="password" type="password" disabled />);

        expect(screen.getByRole('button', { name: 'Показать пароль' })).toBeDisabled();
    });

    it('рендерит поле с типом email', () => {
        render(<TextInput label="Email" id="email" type="email" />);

        expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    });

    it('красит поле в accent-токены при фокусе, без ошибки', () => {
        render(<TextInput label="Email" id="email" />);

        const input = screen.getByLabelText('Email');
        expect(input.className).toMatch(/focus-visible:border-\[var\(--accent\)\]/);
        expect(input.className).toMatch(/focus-visible:shadow-\[var\(--glow\)\]/);
    });
});
