import { clsx } from 'clsx';
import type { TIconName } from '@/shared/ui';
import { Button, Icon } from '@/shared/ui';
import type { TScreenVariant } from './frameset';

type TStep = {
    icon: TIconName;
    title: string;
    text: string;
};

const STEPS: TStep[] = [
    {
        icon: 'target',
        title: 'Прицел',
        text: 'Оттяни палец от танка — направление оттяжки задаёт угол ствола. На десктопе угол правят стрелки и мышь.',
    },
    {
        icon: 'fire',
        title: 'Сила',
        text: 'Длина оттяжки — мощность выстрела. Пунктирный вектор и цифры у пальца показывают, что уйдёт в полёт.',
    },
    {
        icon: 'wind',
        title: 'Ветер',
        text: 'Боковой снос фиксирован на весь бой: первый выстрел — пристрелка. Видно трейл и точку недолёта.',
    },
];

const ACTIVE_STEP = 1;

function StepDots() {
    return (
        <div
            role="img"
            aria-label={`Шаг ${ACTIVE_STEP + 1} из ${STEPS.length}`}
            className="flex gap-2"
        >
            {STEPS.map((step, index) => (
                <span
                    key={step.title}
                    className={clsx(
                        'inline-block size-2.5',
                        index === ACTIVE_STEP
                            ? 'bg-[var(--accent)] shadow-[var(--glow)]'
                            : 'border-2 border-border-strong opacity-60',
                    )}
                />
            ))}
        </div>
    );
}

function StepPictogram({ step }: { step: TStep }) {
    return (
        <div className="flex h-full min-h-40 w-full items-center justify-center border-[length:var(--border-w)] border-border bg-[linear-gradient(150deg,var(--color-panel-raised)_0%,var(--color-surface)_100%)]">
            <Icon name={step.icon} size={96} className="text-[color:var(--accent)]" />
        </div>
    );
}

function StepCard({ step, variant }: { step: TStep; variant: TScreenVariant }) {
    const row = variant !== 'mobile';

    return (
        <div
            className={clsx(
                'flex flex-1 gap-5 border-[length:var(--border-w-thick)] border-border bg-panel p-6 shadow-[var(--shadow-panel)]',
                row ? 'items-stretch' : 'flex-col',
            )}
        >
            <div className={clsx(row ? 'w-[45%] shrink-0' : 'flex-1')}>
                <StepPictogram step={step} />
            </div>
            <div className="flex flex-col justify-center gap-3">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Шаг {ACTIVE_STEP + 1} из {STEPS.length}
                </span>
                <span className="font-display text-h2 text-text uppercase">{step.title}</span>
                <p className="font-ui text-body text-text-muted">{step.text}</p>
            </div>
        </div>
    );
}

/** Остальные шаги списком — на планшете/десктопе весь маршрут виден сразу. */
function StepStrip() {
    return (
        <div className="flex gap-3">
            {STEPS.map((step, index) => (
                <div
                    key={step.title}
                    className={clsx(
                        'flex flex-1 items-center gap-3 border-[length:var(--border-w)] bg-surface px-3 py-2.5',
                        index === ACTIVE_STEP
                            ? 'border-[color:var(--accent)] shadow-[var(--glow)]'
                            : 'border-border',
                    )}
                >
                    <Icon
                        name={step.icon}
                        size={20}
                        className={
                            index === ACTIVE_STEP ? 'text-[color:var(--accent)]' : 'text-text-muted'
                        }
                    />
                    <span className="font-ui text-caption font-bold text-text uppercase">
                        {step.title}
                    </span>
                </div>
            ))}
        </div>
    );
}

function OnboardingFooter() {
    return (
        <div className="flex flex-col gap-3">
            <p className="font-ui text-caption text-text-dim">
                Цель боя — снять врагу HP до нуля. Снаряды кончились (5 на танк) — побеждает больший
                остаток HP.
            </p>
            <div className="flex items-center justify-between gap-3">
                <StepDots />
                <div className="flex gap-2">
                    <Button variant="ghost" className="m-0">
                        Пропустить
                    </Button>
                    <Button variant="primary" className="m-0">
                        Далее
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function OnboardingScreenFrame({ variant }: { variant: TScreenVariant }) {
    const step = STEPS[ACTIVE_STEP];

    if (variant === 'mobile') {
        return (
            <div className="flex h-full w-full flex-col justify-between gap-5 bg-bg px-4 pt-8 pb-6">
                <StepCard step={step} variant={variant} />
                <OnboardingFooter />
            </div>
        );
    }

    return (
        <div className="flex h-full w-full justify-center bg-bg px-10 pt-10 pb-8">
            <div
                className={clsx(
                    'flex w-full flex-col justify-between gap-6',
                    variant === 'desktop' && 'max-w-[900px]',
                )}
            >
                <StepCard step={step} variant={variant} />
                <StepStrip />
                <OnboardingFooter />
            </div>
        </div>
    );
}
