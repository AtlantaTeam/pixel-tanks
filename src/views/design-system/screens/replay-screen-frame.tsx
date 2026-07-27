import { clsx } from 'clsx';
import { BOT_NAME } from '@/shared/config';
import { Button, HPBar, Icon, PipRow, SegmentedControl, ShareButton } from '@/shared/ui';
import { ArenaPlaceholder } from './arena-placeholder';
import { noop, REPLAY_CURRENT_TURN, REPLAY_TOTAL_TURNS, SPEED_OPTIONS } from './_demo';
import type { TScreenVariant } from './frameset';

const TURN_PIPS = Array.from(
    { length: REPLAY_TOTAL_TURNS },
    (_, index) => index < REPLAY_CURRENT_TURN,
);

const SHARE_PAYLOAD = {
    title: 'Pixel Tanks',
    text: 'Смотри мой бой дня',
    url: 'https://pixeltanks.ru/replay/demo',
};

const META = [
    { label: 'Итог', value: 'Победа' },
    { label: 'Дата', value: '27.07.2026' },
    { label: 'Сложность', value: 'Терминатор' },
];

/** Мини-HUD поверх плеера — та же телеметрия, что в бою, но read-only. */
function ReplayTelemetry() {
    return (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-4 border-t-[length:var(--border-w)] border-border bg-bg/80 px-3 py-1.5">
            {[
                { label: 'Угол', value: '47°' },
                { label: 'Сила', value: '064' },
                { label: 'Ветер', value: '0.006' },
            ].map((item) => (
                <span key={item.label} className="flex items-baseline gap-1.5">
                    <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                        {item.label}
                    </span>
                    <span className="font-ui text-caption font-bold text-text tabular-nums">
                        {item.value}
                    </span>
                </span>
            ))}
            <span className="ml-auto font-ui text-label text-text-dim uppercase">read-only</span>
        </div>
    );
}

function ReplayPlayer({ height }: { height: string }) {
    return (
        <div className="flex flex-col gap-3">
            <ArenaPlaceholder className={height}>
                <span className="absolute top-2 left-3 font-ui text-label font-bold tracking-[0.14em] text-accent uppercase">
                    Реплей · ход {REPLAY_CURRENT_TURN}/{REPLAY_TOTAL_TURNS}
                </span>
                <ReplayTelemetry />
            </ArenaPlaceholder>
            <PipRow pips={TURN_PIPS} label="ходов проиграно" />
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" aria-label="Шаг назад" className="m-0">
                    <Icon name="arrow-l" />
                </Button>
                <Button variant="accent" size="icon" aria-label="Пауза" className="m-0">
                    <Icon name="pause" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Шаг вперёд" className="m-0">
                    <Icon name="arrow-r" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Смотреть заново" className="m-0">
                    <Icon name="replay" />
                </Button>
                <SegmentedControl
                    options={SPEED_OPTIONS}
                    value="1"
                    onChange={noop}
                    label="Скорость воспроизведения"
                    className="ml-auto"
                />
            </div>
        </div>
    );
}

function ReplayMeta({ column }: { column: boolean }) {
    return (
        <div
            className={clsx(
                'flex gap-3 border-[length:var(--border-w)] border-border bg-panel p-4',
                column ? 'flex-col' : 'items-center',
            )}
        >
            <div className="flex flex-1 flex-col gap-2">
                <HPBar label="Rex Commander" value={62} faction="player" />
                <HPBar label={BOT_NAME} value={0} faction="enemy" />
            </div>
            <div className={clsx('flex gap-3', column ? 'flex-row' : 'flex-col')}>
                {META.map((item) => (
                    <div key={item.label} className="flex flex-col gap-0.5">
                        <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                            {item.label}
                        </span>
                        <span className="font-ui text-caption font-bold text-text">
                            {item.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ShareCard({ compact }: { compact: boolean }) {
    return (
        <div className="flex flex-col gap-3 border-[length:var(--border-w-thick)] border-border bg-panel p-4 shadow-[var(--shadow-panel)]">
            <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                Карточка шеринга
            </span>
            <ArenaPlaceholder className={compact ? 'h-16' : 'h-24'}>
                <span className="absolute right-3 bottom-2 font-ui text-caption font-bold text-accent uppercase">
                    Победа · HP 62
                </span>
            </ArenaPlaceholder>
            {!compact && (
                <p className="font-ui text-caption text-text-muted">
                    Ссылка открывается без регистрации: бой = seed + размер + ходы.
                </p>
            )}
            <ShareButton label="Скопировать ссылку" buildPayload={() => SHARE_PAYLOAD} />
            <div className="flex gap-2">
                <Button variant="primary" className="m-0 flex-1">
                    Реванш на этом seed
                </Button>
                <Button variant="ghost" className="m-0">
                    В игру
                </Button>
            </div>
        </div>
    );
}

export function ReplayScreenFrame({ variant }: { variant: TScreenVariant }) {
    if (variant === 'mobile') {
        return (
            <div className="flex h-full w-full flex-col gap-3 bg-bg px-4 pt-5 pb-6">
                <ReplayPlayer height="h-36" />
                <ReplayMeta column />
                <ShareCard compact />
            </div>
        );
    }

    const wide = variant === 'desktop';

    return (
        <div className="flex h-full w-full justify-center bg-bg px-8 pt-7 pb-6">
            <div className={clsx('flex w-full gap-5', wide && 'max-w-[1120px] gap-8')}>
                <div className="flex flex-1 flex-col gap-4">
                    <ReplayPlayer height={wide ? 'h-96' : 'h-80'} />
                    <ReplayMeta column={false} />
                </div>
                <div className={wide ? 'w-[360px] shrink-0' : 'w-[280px] shrink-0'}>
                    <ShareCard compact={false} />
                </div>
            </div>
        </div>
    );
}
