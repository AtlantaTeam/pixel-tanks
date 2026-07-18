import type { ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

export type TButtonVariant = 'primary' | 'ghost' | 'danger';
export type TButtonSize = 'sm' | 'md' | 'icon';

const VARIANT_CLASSES: Record<TButtonVariant, string> = {
    primary: 'bg-primary text-surface hover:brightness-110 [--pixel-border-color:var(--color-ink)]',
    ghost: 'bg-panel-deep text-ink hover:bg-panel',
    danger: 'bg-danger text-ink hover:brightness-110',
};

const SIZE_CLASSES: Record<TButtonSize, string> = {
    sm: 'px-3 py-2 text-[10px]',
    md: 'px-5 py-3 text-xs',
    icon: 'size-7 text-[10px]',
};

/** Классы кнопки отдельно от компонента — для Link и других не-button элементов */
export function buttonClasses(
    variant: TButtonVariant = 'primary',
    size: TButtonSize = 'md',
    className?: string,
) {
    return clsx(
        'pixel-border m-1 inline-flex cursor-pointer items-center justify-center font-pixel uppercase',
        'transition-[filter] active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40',
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
