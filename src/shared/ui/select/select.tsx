import type { SelectHTMLAttributes } from 'react';
import { clsx } from 'clsx';

type TSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
    label?: string;
};

export function Select({ label, className, id, ...props }: TSelectProps) {
    return (
        <label className="flex flex-col items-center gap-1" htmlFor={id}>
            {label && <span className="text-xs text-muted">{label}</span>}
            <select
                id={id}
                className={clsx(
                    'pixel-border m-1 w-full cursor-pointer bg-panel-deep px-2 py-1.5',
                    'font-pixel text-[10px] text-ink',
                    className,
                )}
                {...props}
            />
        </label>
    );
}
