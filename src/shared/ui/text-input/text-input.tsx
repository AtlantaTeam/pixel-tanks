'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Icon } from '../icon';

type TTextInputType = 'text' | 'email' | 'password';

type TTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
    type?: TTextInputType;
    label?: string;
    error?: string;
};

/** design-inventory.dc.html §08 «Text Input»: обычное/плейсхолдер, пароль с
 *  eye-toggle, ошибка (border-danger + glow-danger + сообщение), disabled. */
export function TextInput({
    type = 'text',
    label,
    error,
    className,
    id,
    disabled,
    ...props
}: TTextInputProps) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const [passwordVisible, setPasswordVisible] = useState(false);
    const isPassword = type === 'password';
    const resolvedType = isPassword ? (passwordVisible ? 'text' : 'password') : type;

    return (
        <div className={clsx('flex flex-col gap-1.5', disabled && 'opacity-55')}>
            {label && (
                <label
                    htmlFor={inputId}
                    className={clsx(
                        'font-ui text-label font-bold tracking-[0.12em] uppercase',
                        error ? 'text-danger' : 'text-text-muted',
                    )}
                >
                    {label}
                </label>
            )}
            <div className="relative flex items-center">
                <input
                    id={inputId}
                    type={resolvedType}
                    disabled={disabled}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    className={clsx(
                        'w-full border-[length:var(--border-w)] bg-surface px-3.5 py-3 font-ui text-body text-text outline-none placeholder:text-text-dim',
                        'disabled:cursor-not-allowed disabled:bg-muted disabled:text-text-dim',
                        error
                            ? 'border-danger shadow-[var(--glow-danger)]'
                            : 'border-border-strong focus-visible:border-[var(--accent)] focus-visible:shadow-[var(--glow)]',
                        isPassword && 'pr-11',
                        className,
                    )}
                    {...props}
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setPasswordVisible((visible) => !visible)}
                        disabled={disabled}
                        className="absolute right-1 flex size-9 items-center justify-center text-text-muted disabled:cursor-not-allowed"
                        aria-label={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                    >
                        <Icon name={passwordVisible ? 'eye-off' : 'eye'} size={18} />
                    </button>
                )}
            </div>
            {error && (
                <span
                    id={errorId}
                    role="alert"
                    className="flex items-center gap-1.5 text-caption text-danger"
                >
                    <Icon name="close" size={14} />
                    {error}
                </span>
            )}
        </div>
    );
}
