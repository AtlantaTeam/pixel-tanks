import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Icon } from '../icon';

type TErrorBannerProps = HTMLAttributes<HTMLDivElement> & {
    title: string;
    description: string;
    onRetry?: () => void;
    retryLabel?: string;
};

/** design-inventory.dc.html §09 «Ошибка данных»: ⚠-иконка + заголовок/подпись,
 *  опциональная кнопка повтора (↻ из инвентаря — SVG `replay`, эмодзи/юникод в
 *  роли иконки запрещены правилом §07). `role="alert"` несёт aria-live=assertive
 *  неявно, отдельный атрибут не нужен (см. Toast). */
export function ErrorBanner({
    title,
    description,
    onRetry,
    retryLabel = 'Повторить',
    className,
    ...props
}: TErrorBannerProps) {
    return (
        <div
            role="alert"
            className={clsx(
                'flex flex-col items-start gap-3 border-[length:var(--border-w)] border-danger bg-danger/[0.08] p-4',
                className,
            )}
            {...props}
        >
            <div className="flex items-center gap-2 font-ui text-body font-bold text-danger">
                <Icon name="warning" size={16} />
                {title}
            </div>
            <p className="font-ui text-caption text-text-muted">{description}</p>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-[length:var(--border-w)] border-danger px-4 font-ui text-caption font-bold tracking-[0.06em] text-danger uppercase transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-danger)] active:translate-y-0.5"
                >
                    <Icon name="replay" size={14} />
                    {retryLabel}
                </button>
            )}
        </div>
    );
}
