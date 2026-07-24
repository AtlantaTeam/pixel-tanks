import type { ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

export type TButtonVariant = 'primary' | 'accent' | 'ghost' | 'danger';
export type TButtonSize = 'sm' | 'md' | 'icon';

/** `accent` читает --accent/--accent-ink/--glow — переключается атрибутом
 *  [data-faction] на предке (docs/design-system-theming/token-spec.md, §3), без
 *  правки самого компонента.
 *
 *  Объём (edge) и свечение (glow) НЕ через shadow-*-утилиты — они конфликтуют с
 *  box-shadow рамки `pixel-border` (одно свойство, не суммируется). Их отдаём в
 *  слоты `--pixel-border-edge`/`--pixel-border-glow`, которые pixel-border
 *  вкомпоновывает в свой единственный box-shadow. `danger` использует свою
 *  ink-пару (text-danger-ink), иначе светлый текст на #ff4242 даёт ~2.98:1 (fail
 *  WCAG AA). */
const VARIANT_CLASSES: Record<TButtonVariant, string> = {
    primary:
        'bg-primary text-primary-ink [--pixel-border-edge:var(--edge-pixel)] hover:[--pixel-border-glow:var(--glow-primary)] [--pixel-border-color:var(--color-primary-ink)]',
    accent: 'bg-[var(--accent)] text-[var(--accent-ink)] [--pixel-border-edge:var(--edge-pixel)] hover:[--pixel-border-glow:var(--glow)] [--pixel-border-color:var(--accent-ink)]',
    ghost: 'border-[length:var(--border-w)] border-border-strong bg-transparent text-text hover:border-[var(--accent)]',
    danger: 'bg-danger text-danger-ink hover:brightness-110',
};

const SIZE_CLASSES: Record<TButtonSize, string> = {
    sm: 'min-h-11 px-3 py-2 text-[10px]',
    md: 'min-h-11 px-5 py-3 text-xs',
    icon: 'size-11 text-[10px]',
};

/** `disabled` — токены token-spec.md §5 (`bg-muted`/`text-text-dim`, без glow),
 *  а не opacity-затемнение: перекрывает цвет варианта у всех кнопок разом. Рамку и
 *  объём гасим через слоты pixel-border (color→transparent, edge→no-op), а не
 *  `shadow-none` — та боролась бы с box-shadow рамки за то же свойство. */
const DISABLED_CLASSES =
    'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted disabled:text-text-dim disabled:[--pixel-border-color:transparent] disabled:[--pixel-border-edge:0_0_transparent]';

/** Классы кнопки отдельно от компонента — для Link и других не-button элементов */
export function buttonClasses(
    variant: TButtonVariant = 'primary',
    size: TButtonSize = 'md',
    className?: string,
) {
    return clsx(
        'pixel-border m-1 inline-flex cursor-pointer items-center justify-center font-ui tracking-[0.06em] uppercase',
        'transition-[filter] active:translate-y-0.5',
        // Единый видимый фокус для клавиатуры, как у Select — через слот pixel-border,
        // чтобы ринг не конфликтовал с box-shadow рамки (см. VARIANT_CLASSES).
        'focus-visible:outline-none focus-visible:[--pixel-border-ring:var(--ring-focus)]',
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
