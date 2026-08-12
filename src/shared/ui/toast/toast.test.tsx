import { render, screen } from '@testing-library/react';
import { Toast } from './toast';

describe('Toast', () => {
    it('рендерит success как role=status с сообщением', () => {
        render(<Toast variant="success" message="Ссылка на реплей скопирована" />);

        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent('Ссылка на реплей скопирована');
    });

    it('рендерит neutral как role=status с сообщением', () => {
        render(<Toast variant="neutral" message="Синхронизация профиля…" />);

        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent('Синхронизация профиля…');
    });

    it('рендерит error как role=alert с сообщением', () => {
        render(<Toast variant="error" message="Не удалось поделиться" />);

        const toast = screen.getByRole('alert');
        expect(toast).toHaveTextContent('Не удалось поделиться');
    });

    it('role=alert имплицитно объявляет aria-live=assertive, role=status — polite', () => {
        const { rerender } = render(<Toast variant="success" message="Готово" />);
        expect(screen.getByRole('status')).not.toHaveAttribute('aria-live');

        rerender(<Toast variant="error" message="Ошибка" />);
        expect(screen.getByRole('alert')).not.toHaveAttribute('aria-live');
    });

    it('иконка декоративна (aria-hidden), текст несёт смысл', () => {
        render(<Toast variant="success" message="Готово" />);

        const icon = screen.getByRole('status').querySelector('svg');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('красит success токеном --color-success, без хардкода цвета', () => {
        render(<Toast variant="success" message="Готово" />);

        const toast = screen.getByRole('status');
        expect(toast.className).toMatch(/success/);
        expect(toast.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('красит error токеном --color-danger + glow-danger, без хардкода цвета', () => {
        render(<Toast variant="error" message="Ошибка" />);

        const toast = screen.getByRole('alert');
        expect(toast.className).toMatch(/danger/);
        expect(toast.className).toMatch(/glow-danger/);
        expect(toast.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('рендерит warning как role=status (не alert) с сообщением', () => {
        render(<Toast variant="warning" message="Патроны кончились" />);

        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent('Патроны кончились');
    });

    it('красит warning токеном --color-warning, без хардкода цвета', () => {
        render(<Toast variant="warning" message="Патроны кончились" />);

        const toast = screen.getByRole('status');
        expect(toast.className).toMatch(/warning/);
        expect(toast.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('neutral красит бордер border-strong, а левый акцент — text-muted', () => {
        render(<Toast variant="neutral" message="Синхронизация…" />);

        const toast = screen.getByRole('status');
        expect(toast.className).toMatch(/border-strong/);
        expect(toast.className).toMatch(/text-muted/);
    });

    it('принимает произвольный className', () => {
        render(<Toast variant="success" message="Готово" className="mt-4" />);

        expect(screen.getByRole('status')).toHaveClass('mt-4');
    });
});
