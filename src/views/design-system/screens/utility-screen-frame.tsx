import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Button, EmptyState, ErrorBanner, Icon, Skeleton, Spinner } from '@/shared/ui';
import type { TScreenVariant } from './frameset';

const noop = () => {};

type TStateProps = {
    /** Мобильный кадр держит все три заглушки в стопке — контент ужимается, чтобы влезть. */
    compact: boolean;
    className?: string;
};

function UtilityCard({
    title,
    compact,
    children,
    className,
}: TStateProps & { title: string; children: ReactNode }) {
    return (
        <div
            className={clsx(
                'flex min-h-0 flex-1 flex-col overflow-hidden border-[length:var(--border-w-thick)] border-border bg-[radial-gradient(circle_at_50%_35%,var(--color-panel)_0%,var(--color-bg)_100%)] shadow-[var(--shadow-panel)]',
                compact ? 'gap-2 p-3' : 'gap-4 p-5',
                className,
            )}
        >
            <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                {title}
            </span>
            <div
                className={clsx(
                    'flex flex-1 flex-col items-center justify-center text-center',
                    compact ? 'gap-2' : 'gap-4',
                )}
            >
                {children}
            </div>
        </div>
    );
}

function LoadingState({ compact, className }: TStateProps) {
    return (
        <UtilityCard title="Загрузка" compact={compact} className={className}>
            <Spinner
                size={compact ? 28 : 40}
                className="text-[color:var(--accent)]"
                label="Загрузка боя"
            />
            <span className="font-ui text-body text-text">Загрузка боя…</span>
            <div className="flex w-full flex-col gap-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                {!compact && <Skeleton className="h-3 w-2/3" />}
            </div>
        </UtilityCard>
    );
}

function NotFoundState({ compact, className }: TStateProps) {
    return (
        <UtilityCard title="404 · не найдено" compact={compact} className={className}>
            <span
                className={clsx(
                    'font-display text-text uppercase [text-shadow:var(--glow-text)]',
                    compact ? 'text-h2' : 'text-h1',
                )}
            >
                404
            </span>
            {compact ? (
                // В стопке мобильного кадра иконка EmptyState съедает высоту третьей
                // заглушки — оставляем текст и CTA, состояние читается по «404» выше.
                <>
                    <span className="font-ui text-body font-bold text-text">
                        Снаряд улетел за карту
                    </span>
                    <span className="font-ui text-caption text-text-muted">
                        Такой страницы нет.
                    </span>
                    <Button variant="primary" className="m-0">
                        В меню
                    </Button>
                </>
            ) : (
                <EmptyState
                    icon="target"
                    title="Снаряд улетел за карту"
                    description="Такой страницы нет: проверь ссылку или вернись в меню."
                    className="gap-2 px-0 py-0"
                    action={
                        <Button variant="primary" className="m-0">
                            В меню
                        </Button>
                    }
                />
            )}
        </UtilityCard>
    );
}

function ErrorState({ compact, className }: TStateProps) {
    return (
        <UtilityCard title="Ошибка" compact={compact} className={className}>
            <ErrorBanner
                title="Что-то сломалось"
                description={
                    compact
                        ? 'Сервер не ответил.'
                        : 'Сервер не ответил. Повтори попытку или вернись в меню.'
                }
                onRetry={noop}
                className="w-full"
            />
            {!compact && (
                <Button variant="ghost" className="m-0 gap-1.5">
                    <Icon name="arrow-l" size={14} />В меню
                </Button>
            )}
        </UtilityCard>
    );
}

/** Три системные заглушки одним кадром: инвентарь показывает loading/404/ошибку
 *  как срезы одного utility-экрана, а не три отдельные строки каталога. */
export function UtilityScreenFrame({ variant }: { variant: TScreenVariant }) {
    if (variant === 'mobile') {
        return (
            <div className="flex h-full w-full flex-col gap-2.5 bg-bg px-4 pt-4 pb-5">
                <LoadingState compact />
                <NotFoundState compact />
                <ErrorState compact />
            </div>
        );
    }

    // Планшет — первоклассная цель: не три узкие колонки, а сетка 2×2, где ошибка
    // занимает всю ширину нижнего ряда (текст перестаёт рваться по словам).
    if (variant === 'tablet') {
        return (
            <div className="flex h-full w-full flex-col gap-4 bg-bg px-8 pt-8 pb-8">
                <div className="flex min-h-0 flex-1 gap-4">
                    <LoadingState compact={false} />
                    <NotFoundState compact={false} />
                </div>
                <ErrorState compact={false} className="flex-none" />
            </div>
        );
    }

    return (
        <div className="flex h-full w-full justify-center bg-bg px-8 pt-8 pb-8">
            <div className="flex w-full max-w-[1120px] gap-8">
                <LoadingState compact={false} />
                <NotFoundState compact={false} />
                <ErrorState compact={false} />
            </div>
        </div>
    );
}
