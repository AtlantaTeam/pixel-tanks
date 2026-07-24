import type { CSSProperties, HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Panel } from '../panel';

type TDialogProps = HTMLAttributes<HTMLDivElement> & {
    open: boolean;
};

/** Окно диалога темнее и «глубже» Panel (token-spec.md §5: `--color-border-strong`
 *  + `--shadow-drop`) — переопределяем через CSS-переменные, которые Panel читает
 *  как фолбэк, а не конфликтующим Tailwind-классом того же свойства. */
const DIALOG_PANEL_STYLE = {
    '--panel-border-color': 'var(--color-border-strong)',
    '--panel-shadow': 'var(--shadow-drop)',
} as CSSProperties;

export function Dialog({ open, className, children, style, ...props }: TDialogProps) {
    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4"
        >
            <Panel
                className={clsx('w-full max-w-md', className)}
                style={{ ...DIALOG_PANEL_STYLE, ...style }}
                {...props}
            >
                {children}
            </Panel>
        </div>
    );
}
