import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';

type TPanelProps = HTMLAttributes<HTMLDivElement>;

export function Panel({ className, ...props }: TPanelProps) {
    return <div className={clsx('pixel-border m-1 bg-panel p-6 text-ink', className)} {...props} />;
}
