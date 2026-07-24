import { clsx } from 'clsx';
import { Icon } from '../icon';

export type TFactionBadgeFaction = 'player' | 'enemy' | 'unknown';
export type TFactionBadgeSize = 'sm' | 'md';

type TFactionBadgeProps = {
    faction: TFactionBadgeFaction;
    size?: TFactionBadgeSize;
    className?: string;
};

const ICON_BY_FACTION: Record<TFactionBadgeFaction, 'star' | 'skull' | null> = {
    player: 'star',
    enemy: 'skull',
    unknown: null,
};

const SIZE_CLASSES: Record<TFactionBadgeSize, { badge: string }> = {
    md: {
        badge: 'size-14 border-[3px]',
    },
    sm: {
        badge: 'size-11 border-[2px]',
    },
};

export function FactionBadge({ faction, size = 'md', className }: TFactionBadgeProps) {
    const isUnknown = faction === 'unknown';
    const sizeClasses = SIZE_CLASSES[size];
    const iconName = ICON_BY_FACTION[faction];

    return (
        <div
            {...(isUnknown ? {} : { 'data-faction': faction })}
            className={clsx(
                'pixel-border',
                'flex',
                'items-center',
                'justify-center',
                sizeClasses.badge,
                isUnknown && 'bg-muted border-border-strong text-text-dim',
                !isUnknown && [
                    'bg-surface',
                    'border-[color:var(--accent)]',
                    '[--pixel-border-glow:var(--glow)]',
                    'text-[color:var(--accent)]',
                ],
                className,
            )}
        >
            {iconName && <Icon name={iconName} />}
            {isUnknown && <span className="text-[20px]">?</span>}
        </div>
    );
}
