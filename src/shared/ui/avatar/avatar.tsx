import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export type TAvatarFaction = 'player' | 'enemy';

type TAvatarProps = {
    faction: TAvatarFaction;
    icon?: string | ReactNode;
    children?: ReactNode;
    className?: string;
};

export function Avatar({ faction, icon, children, className }: TAvatarProps) {
    const content = icon ?? children;

    return (
        <div
            data-faction={faction}
            className={clsx(
                'pixel-border',
                'size-14',
                'border-[3px]',
                'bg-surface',
                'border-[color:var(--accent)]',
                '[--pixel-border-glow:var(--glow)]',
                'flex',
                'items-center',
                'justify-center',
                'text-[26px]',
                'text-[color:var(--accent)]',
                className,
            )}
        >
            {content}
        </div>
    );
}
