'use client';

import type { CSSProperties, HTMLAttributes } from 'react';
import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Panel } from '../panel';

type TDialogProps = HTMLAttributes<HTMLDivElement> & {
    open: boolean;
    /** Передан → Esc и клик по затемнению закрывают диалог. Без него (напр.
     *  game-over, где «закрывать» некуда) окно управляется только своим `open`. */
    onClose?: () => void;
    /** `'modal'` (по умолчанию) — реальный оверлей `fixed` на весь viewport с
     *  focus-trap и Esc. `'static'` — статичный срез состояния «открыто» в потоке
     *  страницы (витрина `/design-system`): без `fixed`-позиционирования и без
     *  кражи фокуса, так что несколько таких срезов спокойно сосуществуют на одной
     *  странице рядом с остальными секциями. */
    variant?: 'modal' | 'static';
};

/** Окно диалога темнее и «глубже» Panel (token-spec.md §5: `--color-border-strong`
 *  + `--shadow-drop`) — переопределяем через CSS-переменные, которые Panel читает
 *  как фолбэк, а не конфликтующим Tailwind-классом того же свойства. */
const DIALOG_PANEL_STYLE = {
    '--panel-border-color': 'var(--color-border-strong)',
    '--panel-shadow': 'var(--shadow-drop)',
} as CSSProperties;

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
    open,
    onClose,
    variant = 'modal',
    className,
    children,
    style,
    ...props
}: TDialogProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const isStatic = variant === 'static';

    // Доступность модалки: на открытии фокус уводится внутрь окна и запирается в
    // нём (Tab не уходит на фон), Esc закрывает (если можно), по закрытии фокус
    // возвращается на элемент, с которого открыли. Статичный срез витрины не
    // делает ничего из этого — он не перехватывает страницу.
    useEffect(() => {
        if (!open || isStatic) return;
        const root = rootRef.current;
        const previouslyFocused = document.activeElement as HTMLElement | null;

        const focusables = () =>
            root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];

        (focusables()[0] ?? root)?.focus();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose?.();
                return;
            }
            if (e.key !== 'Tab') return;
            const items = focusables();
            if (items.length === 0) {
                e.preventDefault();
                root?.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus?.();
        };
    }, [open, onClose, isStatic]);

    if (!open) return null;

    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-modal={isStatic ? undefined : true}
            tabIndex={isStatic ? undefined : -1}
            onClick={
                !isStatic && onClose ? (e) => e.target === e.currentTarget && onClose() : undefined
            }
            className={clsx(
                'flex items-center justify-center bg-bg/70 p-4 focus-visible:outline-none',
                isStatic ? 'relative' : 'fixed inset-0 z-50',
            )}
            {...props}
        >
            <Panel
                className={clsx('w-full max-w-md', className)}
                style={{ ...DIALOG_PANEL_STYLE, ...style }}
            >
                {children}
            </Panel>
        </div>
    );
}
