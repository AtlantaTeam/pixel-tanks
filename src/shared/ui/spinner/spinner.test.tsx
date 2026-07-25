import { render, screen } from '@testing-library/react';
import { Spinner } from './spinner';

describe('Spinner', () => {
    it('рендерится как role=status', () => {
        render(<Spinner />);

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('несёт дефолтную метку «Загрузка» для скринридера', () => {
        render(<Spinner />);

        expect(screen.getByRole('status')).toHaveTextContent('Загрузка');
    });

    it('позволяет переопределить метку', () => {
        render(<Spinner label="Синхронизация профиля" />);

        expect(screen.getByRole('status')).toHaveTextContent('Синхронизация профиля');
    });

    it('визуальный круг декоративен — метка передаёт смысл скринридеру', () => {
        const { container } = render(<Spinner />);

        const visual = container.querySelector('[aria-hidden="true"]');
        expect(visual).not.toBeNull();
    });

    it('гасит анимацию при prefers-reduced-motion', () => {
        const { container } = render(<Spinner />);

        const visual = container.querySelector('[aria-hidden="true"]');
        expect(visual?.className).toMatch(/motion-reduce:animate-none/);
    });

    it('принимает размер и произвольный className', () => {
        const { container } = render(<Spinner size={32} className="text-accent" />);

        expect(screen.getByRole('status')).toHaveClass('text-accent');
        const visual = container.querySelector('[aria-hidden="true"]') as HTMLElement;
        expect(visual.style.width).toBe('32px');
        expect(visual.style.height).toBe('32px');
    });
});
