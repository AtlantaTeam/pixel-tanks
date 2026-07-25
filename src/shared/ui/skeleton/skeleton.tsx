import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';

type TSkeletonProps = HTMLAttributes<HTMLDivElement>;

/** design-inventory.dc.html §09 «Loading — скелетон»: бегущий блик по градиенту
 *  surface→panel-raised (`.om-skel`). Не задаёт свой размер — вызывающий код
 *  собирает строки нужной высоты/ширины через `className` (см. витрину). */
export function Skeleton({ className, ...props }: TSkeletonProps) {
    return (
        <div
            aria-hidden="true"
            className={clsx(
                'animate-shimmer bg-[length:400px_100%] motion-reduce:animate-none',
                'bg-[linear-gradient(90deg,var(--color-surface)_0,var(--color-panel-raised)_40px,var(--color-surface)_80px)]',
                className,
            )}
            {...props}
        />
    );
}
