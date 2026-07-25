import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';

type TSpinnerProps = HTMLAttributes<HTMLSpanElement> & {
    size?: number;
    label?: string;
};

/** design-inventory.dc.html §09 (спиннер в loading-кнопке): круг с прозрачным
 *  верхним краем, крутится 0.7s linear (fidelity к инвентарю — быстрее дефолтной
 *  1s у `animate-spin`). `currentColor` — цвет задаётся текстовым токеном
 *  вызывающего кода (`className="text-accent"` и т.п.), как у Icon.
 *  Толщина кольца масштабируется от size (~0.15·d, минимум 2px), чтобы на крупных
 *  размерах кольцо не «худело» относительно эталонного 3px@20px. */
export function Spinner({ size = 20, label = 'Загрузка', className, ...props }: TSpinnerProps) {
    const borderWidth = Math.max(2, Math.round(size * 0.15));

    return (
        <span
            role="status"
            className={clsx('inline-flex items-center justify-center', className)}
            {...props}
        >
            <span
                aria-hidden="true"
                style={{ width: size, height: size, borderWidth }}
                className="animate-spin rounded-full border-current border-t-transparent [animation-duration:0.7s] motion-reduce:animate-none"
            />
            <span className="sr-only">{label}</span>
        </span>
    );
}
