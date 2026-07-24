import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';

type TPanelProps = HTMLAttributes<HTMLDivElement>;

/** Рамка/тень читают `--panel-border-color`/`--panel-shadow` с фолбэком на
 *  токены по умолчанию (token-spec.md §5) — Dialog переопределяет их через
 *  `style`, не борясь с Panel за specificity одноимённых Tailwind-утилит. */
export function Panel({ className, ...props }: TPanelProps) {
    return (
        <div
            className={clsx(
                'm-1 border-[length:var(--border-w-thick)] border-[var(--panel-border-color,var(--color-border))]',
                'bg-panel p-6 text-text shadow-[var(--panel-shadow,var(--shadow-panel))]',
                className,
            )}
            {...props}
        />
    );
}
