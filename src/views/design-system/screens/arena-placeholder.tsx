import type { ReactNode } from 'react';
import { clsx } from 'clsx';

type TArenaPlaceholderProps = {
    className?: string;
    children?: ReactNode;
};

/** Статичная заглушка арены для превью-кадров: градиент рельефа + два танка-метки.
 *  Арт арены/танков сменяемый (биомы и скины), витрина его не судит — превью держит
 *  только UI-оболочку, читаемую над любым скином (как §10 «Игровые контролы»). */
export function ArenaPlaceholder({ className, children }: TArenaPlaceholderProps) {
    return (
        <div
            className={clsx(
                'relative overflow-hidden border-[length:var(--border-w)] border-border bg-surface',
                className,
            )}
        >
            <div
                aria-hidden
                className="absolute inset-0 bg-[linear-gradient(180deg,var(--color-panel)_0%,var(--color-surface)_60%,var(--color-muted)_100%)]"
            />
            <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-1/4 bg-[linear-gradient(0deg,var(--color-muted)_0%,transparent_100%)]"
            />
            <span
                aria-hidden
                className="absolute bottom-[14%] left-[10%] size-4 bg-accent shadow-[var(--glow-accent)]"
            />
            <span
                aria-hidden
                className="absolute bottom-[22%] right-[12%] size-4 bg-enemy shadow-[var(--glow-enemy)]"
            />
            {children && <div className="relative size-full">{children}</div>}
        </div>
    );
}
