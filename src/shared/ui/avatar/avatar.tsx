import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { TFaction } from '@/shared/lib/theme';
import { badgeShellClasses } from '../badge-shell';

export type TAvatarFaction = TFaction;

type TAvatarProps = {
    faction: TAvatarFaction;
    icon?: ReactNode;
    children?: ReactNode;
    className?: string;
};

export function Avatar({ faction, icon, children, className }: TAvatarProps) {
    const content = icon ?? children;

    return (
        <div
            data-faction={faction}
            className={clsx(
                badgeShellClasses(faction),
                'size-14',
                'border-[3px]',
                'text-[26px]',
                className,
            )}
        >
            {content}
        </div>
    );
}
