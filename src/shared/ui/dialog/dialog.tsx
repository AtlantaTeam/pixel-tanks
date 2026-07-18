import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Panel } from '../panel';

type TDialogProps = HTMLAttributes<HTMLDivElement> & {
    open: boolean;
};

export function Dialog({ open, className, children, ...props }: TDialogProps) {
    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-surface/80 p-4"
        >
            <Panel className={clsx('w-full max-w-md', className)} {...props}>
                {children}
            </Panel>
        </div>
    );
}
