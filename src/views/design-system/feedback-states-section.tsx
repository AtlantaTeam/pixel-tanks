import { Button, EmptyState, ErrorBanner, Skeleton, Spinner } from '@/shared/ui';

/** design-inventory.dc.html §09 «Кнопки · данные · формы»: доп. состояния кнопки
 *  (фокус-ринг, загрузка, disabled) и переиспользуемые состояния данных. */
export function FeedbackStatesSection() {
    return (
        <div className="flex flex-col gap-0.5">
            <div className="grid grid-cols-1 gap-0.5 lg:grid-cols-2">
                <div className="flex flex-col gap-4 border-[length:var(--border-w)] border-border bg-panel p-6">
                    <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                        Button — доп. состояния
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button
                            variant="primary"
                            style={{ boxShadow: 'var(--ring-focus)' }}
                            aria-label=":focus-visible (демо-срез)"
                        >
                            :focus-visible
                        </Button>
                        <Button
                            variant="primary"
                            aria-busy="true"
                            className="cursor-progress gap-2"
                        >
                            <Spinner size={15} className="text-primary-ink" />
                            Загрузка
                        </Button>
                        <Button variant="ghost" disabled>
                            Disabled
                        </Button>
                    </div>
                    <span className="font-ui text-label leading-[1.5] text-text-dim">
                        hover/active — в базовых вариантах (§03). Здесь: фокус-ринг (--ring-focus),
                        загрузка-спиннер, disabled.
                    </span>
                </div>

                <div className="flex flex-col gap-3.5 border-[length:var(--border-w)] border-border bg-panel p-6">
                    <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                        Форма — ошибка сабмита (баннер)
                    </span>
                    <ErrorBanner
                        title="Неверный email или пароль"
                        description="Проверьте данные и попробуйте снова."
                    />
                    <Button variant="primary" className="self-start">
                        Войти
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-3">
                <div className="flex flex-col gap-3 border-[length:var(--border-w)] border-border bg-panel p-5">
                    <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                        Loading — скелетон
                    </span>
                    <div className="flex flex-col gap-2">
                        <Skeleton className="h-[38px] w-full" />
                        <Skeleton className="h-[38px] w-full" />
                        <Skeleton className="h-[38px] w-[82%]" />
                    </div>
                </div>

                <div className="border-[length:var(--border-w)] border-border bg-panel">
                    <EmptyState
                        icon="target"
                        title="Боёв пока нет"
                        description="Сыграй первый матч — история появится здесь."
                        action={
                            <Button variant="accent" size="md">
                                В бой
                            </Button>
                        }
                    />
                </div>

                <div className="flex flex-col gap-3 border-[length:var(--border-w)] border-border bg-panel p-5">
                    <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                        Ошибка данных
                    </span>
                    <ErrorBanner
                        title="Не удалось загрузить"
                        description="Сервер недоступен. Проверьте соединение."
                        onRetry={() => {}}
                    />
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-10 gap-y-4 border-[length:var(--border-w)] border-border bg-panel p-6">
                <div className="flex flex-col items-center gap-2">
                    <span className="font-ui text-caption text-text-muted">default</span>
                    <Spinner className="text-accent" />
                </div>
                <div className="flex flex-col items-center gap-2">
                    <span className="font-ui text-caption text-text-muted">size 32</span>
                    <div className="flex items-center justify-center bg-primary p-2">
                        <Spinner size={32} label="Загрузка" className="text-primary-ink" />
                    </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                    <span className="font-ui text-caption text-text-muted">кастомная метка</span>
                    <Spinner label="Синхронизация профиля" className="text-text-muted" />
                </div>
            </div>
        </div>
    );
}
