import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Icon, type TIconName } from '../icon';

export type TToastVariant = 'success' | 'neutral' | 'error' | 'warning';

type TToastProps = HTMLAttributes<HTMLDivElement> & {
    variant: TToastVariant;
    message: string;
};

const VARIANT_CONFIG: Record<
    TToastVariant,
    { role: 'status' | 'alert'; icon: TIconName; toastClassName: string; iconClassName: string }
> = {
    success: {
        role: 'status',
        icon: 'check',
        toastClassName: 'border-t-success border-r-success border-b-success border-l-success',
        iconClassName: 'text-success',
    },
    neutral: {
        role: 'status',
        // В инвентаре нейтральный тост несёт глиф ◔ (индикатор прогресса/синхронизации).
        // В icon-set нет progress-иконки, поэтому кодифицируем ближайшую по смыслу `clock`
        // (правило «эмодзи/юникод → SVG — наша кодификация»). Появится progress-иконка — вернуть.
        icon: 'clock',
        toastClassName:
            'border-t-border-strong border-r-border-strong border-b-border-strong border-l-text-muted',
        iconClassName: 'text-text-muted',
    },
    error: {
        role: 'alert',
        icon: 'close',
        toastClassName:
            'border-t-danger border-r-danger border-b-danger border-l-danger shadow-[var(--glow-danger)]',
        iconClassName: 'text-danger',
    },
    // Боевой экран (handoff «Патроны кончились»): предупреждение, не ошибка —
    // role="status" (polite), не "alert".
    warning: {
        role: 'status',
        icon: 'warning',
        toastClassName: 'border-t-warning border-r-warning border-b-warning border-l-warning',
        iconClassName: 'text-warning',
    },
};

/** design-inventory.dc.html §Toast: success/нейтраль/ошибка. `role="status"` (success/neutral)
 *  и `role="alert"` (error) несут aria-live неявно (polite/assertive) — отдельный атрибут не нужен.
 *  Левый бордер — акцентная полоса варианта поверх общей рамки (4px против 2px). */
export function Toast({ variant, message, className, ...props }: TToastProps) {
    const config = VARIANT_CONFIG[variant];

    return (
        <div
            role={config.role}
            className={clsx(
                'flex items-center gap-2.5 bg-surface px-3.5 py-3',
                'border-t-[length:var(--border-w)] border-r-[length:var(--border-w)] border-b-[length:var(--border-w)] border-l-4',
                config.toastClassName,
                className,
            )}
            {...props}
        >
            <Icon name={config.icon} size={16} className={config.iconClassName} />
            <span className="font-ui text-caption text-text">{message}</span>
        </div>
    );
}
