import type { ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

export type TButtonVariant = 'primary' | 'accent' | 'ghost' | 'danger';
export type TButtonSize = 'sm' | 'md' | 'icon';

/** `accent` читает --accent/--accent-ink/--glow — переключается атрибутом
 *  [data-faction] на предке (docs/design-system-theming/token-spec.md, §3), без
 *  правки самого компонента.
 *
 *  primary/accent без рамки: объём и свечение — box-shadow из токенов
 *  (`--edge-pixel`/`--glow-*`), как в design-inventory.dc.html. `danger` — плоский
 *  outline (транспарентный фон + рамка/текст `--color-danger`), тот же паттерн,
 *  что и retry-кнопка в инвентаре. */
const VARIANT_CLASSES: Record<TButtonVariant, string> = {
    primary:
        'bg-primary text-primary-ink shadow-[var(--edge-pixel)] hover:shadow-[var(--edge-pixel),var(--glow-primary)]',
    accent: 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-[var(--edge-pixel)] hover:shadow-[var(--edge-pixel),var(--glow)]',
    ghost: 'border-[length:var(--border-w)] border-border-strong bg-transparent text-text hover:border-[var(--accent)]',
    danger: 'border-[length:var(--border-w)] border-danger bg-transparent text-danger',
};

const SIZE_CLASSES: Record<TButtonSize, string> = {
    sm: 'min-h-11 px-3 py-2 text-[10px]',
    md: 'min-h-11 px-5 py-3 text-xs',
    icon: 'size-11 text-[10px]',
};

/** `disabled` — токены token-spec.md §5 (`bg-muted`/`text-text-dim`, без glow),
 *  а не opacity-затемнение: перекрывает цвет варианта у всех кнопок разом. */
const DISABLED_CLASSES =
    'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted disabled:text-text-dim disabled:shadow-none';

/** Классы кнопки отдельно от компонента — для Link и других не-button элементов */
export function buttonClasses(
    variant: TButtonVariant = 'primary',
    size: TButtonSize = 'md',
    className?: string,
) {
    return clsx(
        'm-1 inline-flex cursor-pointer items-center justify-center font-ui tracking-[0.06em] uppercase',
        'transition-[filter] active:translate-y-0.5',
        'focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)]',
        DISABLED_CLASSES,
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
    );
}

type TButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: TButtonVariant;
    size?: TButtonSize;
};

export function Button({ variant = 'primary', size = 'md', className, ...props }: TButtonProps) {
    return <button type="button" className={buttonClasses(variant, size, className)} {...props} />;
}
