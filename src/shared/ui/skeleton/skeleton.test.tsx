import { render } from '@testing-library/react';
import { Skeleton } from './skeleton';

describe('Skeleton', () => {
    it('декоративен — скрыт от скринридера (реальный контент ещё не пришёл)', () => {
        const { container } = render(<Skeleton className="h-[38px] w-full" />);

        const skeleton = container.firstElementChild as HTMLElement;
        expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    });

    it('красится анимированным градиентом из семантических токенов, не хардкодом', () => {
        const { container } = render(<Skeleton className="h-[38px] w-full" />);

        const skeleton = container.firstElementChild as HTMLElement;
        expect(skeleton.className).toMatch(/animate-shimmer/);
        expect(skeleton.className).toMatch(/var\(--color-surface\)/);
        expect(skeleton.className).toMatch(/var\(--color-panel-raised\)/);
        expect(skeleton.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('гасит анимацию при prefers-reduced-motion', () => {
        const { container } = render(<Skeleton className="h-[38px] w-full" />);

        const skeleton = container.firstElementChild as HTMLElement;
        expect(skeleton.className).toMatch(/motion-reduce:animate-none/);
    });

    it('принимает произвольный className для размера строки', () => {
        const { container } = render(<Skeleton className="h-[38px] w-[82%]" />);

        const skeleton = container.firstElementChild as HTMLElement;
        expect(skeleton).toHaveClass('h-[38px]', 'w-[82%]');
    });
});
