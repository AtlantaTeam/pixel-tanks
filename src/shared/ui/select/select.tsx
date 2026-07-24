import type { SelectHTMLAttributes } from 'react';
import { clsx } from 'clsx';

type TSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
    label?: string;
};

export function Select({ label, className, id, ...props }: TSelectProps) {
    return (
        <label className="flex flex-col items-center gap-1" htmlFor={id}>
            {label && <span className="text-xs text-text-muted">{label}</span>}
            <select
                id={id}
                className={clsx(
                    'm-1 min-h-11 w-full cursor-pointer border-[length:var(--border-w)] border-border-strong bg-surface px-2 py-1.5',
                    'font-ui text-[10px] text-text',
                    'focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)]',
                    className,
                )}
                {...props}
            />
        </label>
    );
}
