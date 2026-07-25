import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBanner } from './error-banner';

describe('ErrorBanner', () => {
    it('рендерится как role=alert с заголовком и описанием', () => {
        render(
            <ErrorBanner
                title="Не удалось загрузить"
                description="Сервер недоступен. Проверьте соединение."
            />,
        );

        const banner = screen.getByRole('alert');
        expect(banner).toHaveTextContent('Не удалось загрузить');
        expect(banner).toHaveTextContent('Сервер недоступен. Проверьте соединение.');
    });

    it('без onRetry не рендерит кнопку повтора', () => {
        render(<ErrorBanner title="Не удалось загрузить" description="Сервер недоступен." />);

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('с onRetry рендерит кнопку повтора и зовёт колбэк по клику', () => {
        const onRetry = vi.fn();
        render(
            <ErrorBanner
                title="Не удалось загрузить"
                description="Сервер недоступен."
                onRetry={onRetry}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Повторить/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('позволяет переопределить текст кнопки повтора', () => {
        render(
            <ErrorBanner
                title="Не удалось загрузить"
                description="Сервер недоступен."
                onRetry={() => {}}
                retryLabel="Ещё раз"
            />,
        );

        expect(screen.getByRole('button', { name: /Ещё раз/i })).toBeInTheDocument();
    });

    it('иконка декоративна — смысл несёт текст', () => {
        render(<ErrorBanner title="Не удалось загрузить" description="Сервер недоступен." />);

        const icon = screen.getByRole('alert').querySelector('svg');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('красится токеном --color-danger, без хардкода цвета', () => {
        render(<ErrorBanner title="Не удалось загрузить" description="Сервер недоступен." />);

        const banner = screen.getByRole('alert');
        expect(banner.className).toMatch(/danger/);
        expect(banner.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });
});
