'use client';

import { clsx } from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

type TToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onChange' | 'value'> & {
    label: string;
    sublabel?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
};

/** design-inventory.dc.html §03 «Toggle»: выключатель вкл/выкл (вибрация, звук, спокойный HUD)
 *  на --accent при включении, glow в активном состоянии. role="switch" с aria-checked. */
export function Toggle({
    label,
    sublabel,
    checked,
    onChange,
    disabled = false,
    className,
    ...rest
}: TToggleProps) {
    const handleToggle = () => {
        if (!disabled) {
            onChange(!checked);
        }
    };

    return (
        <button
            {...rest}
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={handleToggle}
            className={clsx(
                'flex w-full items-center justify-between gap-3 border-none bg-transparent px-0 py-2',
                'font-ui text-text outline-none transition-colors',
                'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
                className,
            )}
        >
            <div className="flex flex-col gap-0.5">
                <span className="font-bold text-caption">{label}</span>
                {sublabel && <span className="text-label text-text-muted">{sublabel}</span>}
            </div>

            <div
                className={clsx(
                    'relative shrink-0 h-7 w-13 border-[length:var(--border-w)] rounded-none transition-all duration-120',
                    checked
                        ? 'bg-[var(--accent)] border-[var(--accent)] shadow-[var(--glow)]'
                        : 'bg-surface border-border-strong',
                )}
                aria-hidden="true"
            >
                <span
                    className={clsx(
                        'absolute top-[2px] w-5 h-5 rounded-none transition-all duration-120',
                        checked ? 'left-[26px] bg-[var(--accent-ink)]' : 'left-[2px] bg-text-dim',
                    )}
                />
            </div>
        </button>
    );
}
