import type { HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';
import type { TIconName } from '../icon';
import { Icon } from '../icon';

type TEmptyStateProps = HTMLAttributes<HTMLDivElement> & {
    icon: TIconName;
    title: string;
    description: string;
    action?: ReactNode;
};

/** design-inventory.dc.html §09 «Пустое состояние»: иконка + заголовок + подпись,
 *  по центру, опциональный CTA снизу (`action` — вызывающий код передаёт готовую
 *  `Button`, ДС не решает за него, что произойдёт по клику). */
export function EmptyState({
    icon,
    title,
    description,
    action,
    className,
    ...props
}: TEmptyStateProps) {
    return (
        <div
            className={clsx('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}
            {...props}
        >
            <Icon name={icon} size={34} className="text-text-dim" />
            <p className="font-ui text-body font-bold text-text">{title}</p>
            <p className="max-w-prose font-ui text-caption text-text-muted">{description}</p>
            {action && <div className="mt-1">{action}</div>}
        </div>
    );
}
