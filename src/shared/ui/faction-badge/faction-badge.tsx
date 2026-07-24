import { clsx } from 'clsx';
import type { TFaction } from '@/shared/lib/theme';
import { badgeShellClasses } from '../badge-shell';
import { Icon } from '../icon';

export type TFactionBadgeFaction = TFaction | 'unknown';
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
            className={clsx(badgeShellClasses(faction), sizeClasses.badge, className)}
        >
            {iconName && <Icon name={iconName} />}
            {isUnknown && <span className="text-[20px]">?</span>}
        </div>
    );
}
