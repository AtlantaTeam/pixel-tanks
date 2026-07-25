import { render, screen } from '@testing-library/react';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
    it('показывает заголовок и описание', () => {
        render(
            <EmptyState
                icon="target"
                title="Боёв пока нет"
                description="Сыграй первый матч — история появится здесь."
            />,
        );

        expect(screen.getByText('Боёв пока нет')).toBeInTheDocument();
        expect(
            screen.getByText('Сыграй первый матч — история появится здесь.'),
        ).toBeInTheDocument();
    });

    it('иконка декоративна — смысл несёт текст', () => {
        render(
            <EmptyState icon="target" title="Боёв пока нет" description="Сыграй первый матч." />,
        );

        const icon = document.querySelector('svg');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('без action не рендерит кнопку', () => {
        render(
            <EmptyState icon="target" title="Боёв пока нет" description="Сыграй первый матч." />,
        );

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('рендерит переданный action', () => {
        render(
            <EmptyState
                icon="target"
                title="Боёв пока нет"
                description="Сыграй первый матч."
                action={<button type="button">В бой</button>}
            />,
        );

        expect(screen.getByRole('button', { name: 'В бой' })).toBeInTheDocument();
    });

    it('принимает произвольный className', () => {
        const { container } = render(
            <EmptyState
                icon="target"
                title="Боёв пока нет"
                description="Сыграй первый матч."
                className="mt-4"
            />,
        );

        expect(container.firstElementChild as HTMLElement).toHaveClass('mt-4');
    });
});
