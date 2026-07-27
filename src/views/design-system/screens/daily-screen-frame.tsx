import { clsx } from 'clsx';
import type { TSegmentedControlOption } from '@/shared/ui';
import { Button, FactionBadge, Icon, SegmentedControl } from '@/shared/ui';
import { ArenaPlaceholder } from './arena-placeholder';
import type { TScreenVariant } from './frameset';

const noop = () => {};

const PERIOD_OPTIONS: TSegmentedControlOption<'day' | 'all'>[] = [
    { value: 'day', label: 'День' },
    { value: 'all', label: 'Всё время' },
];

type TLeaderRow = {
    rank: number;
    nickname: string;
    faction: 'player' | 'enemy';
    hp: string;
    /** Строка самого игрока — левая accent-полоса (token-spec §6). */
    own?: boolean;
};

const LEADERBOARD: TLeaderRow[] = [
    { rank: 1, nickname: 'Iron Maiden', faction: 'enemy', hp: '94' },
    { rank: 2, nickname: 'Steel Fox', faction: 'player', hp: '88' },
    { rank: 3, nickname: 'Rex Commander', faction: 'player', hp: '62', own: true },
    { rank: 4, nickname: 'Pixel Anna', faction: 'player', hp: '51' },
    { rank: 5, nickname: 'Bot Killer', faction: 'enemy', hp: '37' },
];

const CONDITIONS = [
    { label: 'Сложность', value: 'Терминатор' },
    { label: 'Ветер', value: '0.006' },
    { label: 'Рельеф', value: 'Общий' },
];

function ChallengeCard({ variant }: { variant: TScreenVariant }) {
    const compact = variant === 'mobile';

    return (
        <div className="flex flex-col gap-3 border-[length:var(--border-w-thick)] border-border bg-panel p-4 shadow-[var(--shadow-panel)]">
            <div className="flex items-baseline justify-between">
                <span className="font-display text-h2 text-text uppercase">Бой дня</span>
                <span className="font-ui text-caption text-text-muted">27 июля</span>
            </div>
            <ArenaPlaceholder className={compact ? 'h-20' : 'h-40'}>
                <span className="absolute top-2 left-3 font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Биом дня · закат, буря
                </span>
            </ArenaPlaceholder>
            <div className="grid grid-cols-3 gap-2">
                {CONDITIONS.map((condition) => (
                    <div
                        key={condition.label}
                        className={clsx(
                            'flex flex-col gap-0.5 border-[length:var(--border-w)] border-border bg-surface',
                            compact ? 'px-2 py-1' : 'px-2.5 py-2',
                        )}
                    >
                        <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                            {condition.label}
                        </span>
                        <span className="font-ui text-caption font-bold text-text tabular-nums">
                            {condition.value}
                        </span>
                    </div>
                ))}
            </div>
            <div className="flex items-center justify-between border-[length:var(--border-w)] border-primary bg-surface px-3 py-2 shadow-[var(--glow-primary)]">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Стрик боёв дня
                </span>
                <span className="font-ui text-hud font-bold text-primary tabular-nums">5</span>
            </div>
            <div className="flex items-center gap-2 font-ui text-caption text-accent">
                <Icon name="check" size={14} />
                Сегодня сыграно · результат засчитан
            </div>
            <div className="flex gap-2">
                <Button variant="primary" className="m-0 flex-1">
                    Принять вызов
                </Button>
                <Button variant="ghost" className="m-0 gap-1.5">
                    <Icon name="replay" size={14} />
                    Мой реплей
                </Button>
            </div>
        </div>
    );
}

/** Состояние «результат/сравнение» — после боя: свой результат, место и отрыв от топа. */
function ResultCard() {
    return (
        <div className="flex items-center gap-5 border-[length:var(--border-w)] border-[color:var(--accent)] bg-panel px-5 py-3 shadow-[var(--glow)]">
            <div className="flex flex-col">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Твой результат
                </span>
                <span className="font-ui text-hud-xl font-bold text-text tabular-nums">62</span>
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="font-ui text-caption text-text">3 место из 128</span>
                <span className="font-ui text-label text-text-muted tabular-nums">
                    До топа дня — 32 HP · стрик +1
                </span>
            </div>
            <Button variant="accent" className="m-0 ml-auto gap-1.5">
                <Icon name="share" size={14} />
                Поделиться реплеем
            </Button>
        </div>
    );
}

function Leaderboard({ rows }: { rows: number }) {
    return (
        <div className="flex flex-col gap-2 border-[length:var(--border-w-thick)] border-border bg-panel p-4 shadow-[var(--shadow-panel)]">
            <div className="flex items-center justify-between gap-3">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Лидерборд
                </span>
                <SegmentedControl
                    options={PERIOD_OPTIONS}
                    value="day"
                    onChange={noop}
                    label="Период лидерборда"
                />
            </div>
            {LEADERBOARD.slice(0, rows).map((row) => (
                <div
                    key={row.rank}
                    className={clsx(
                        'flex items-center gap-3 border-[length:var(--border-w)] bg-surface px-3 py-2',
                        row.rank === 1
                            ? 'border-primary shadow-[var(--glow-primary)]'
                            : 'border-border',
                        row.own && 'border-l-4 border-l-[color:var(--accent)]',
                    )}
                >
                    <span
                        className={clsx(
                            'w-5 font-ui text-caption font-bold tabular-nums',
                            row.rank === 1 ? 'text-primary' : 'text-text-muted',
                        )}
                    >
                        {row.rank}
                    </span>
                    <FactionBadge faction={row.faction} size="sm" className="size-8 border-2" />
                    <span className="flex-1 truncate font-ui text-caption text-text">
                        {row.nickname}
                    </span>
                    <span className="font-ui text-caption font-bold text-text tabular-nums">
                        HP {row.hp}
                    </span>
                    <Icon name="replay" size={14} className="text-text-muted" />
                </div>
            ))}
        </div>
    );
}

export function DailyScreenFrame({ variant }: { variant: TScreenVariant }) {
    if (variant === 'mobile') {
        return (
            <div className="flex h-full w-full flex-col gap-3 bg-bg px-4 pt-5 pb-6">
                <ChallengeCard variant={variant} />
                <Leaderboard rows={3} />
            </div>
        );
    }

    if (variant === 'tablet') {
        return (
            <div className="flex h-full w-full flex-col gap-4 bg-bg px-8 pt-7 pb-6">
                <ResultCard />
                <div className="flex flex-1 gap-4">
                    <div className="w-[52%]">
                        <ChallengeCard variant={variant} />
                    </div>
                    <div className="flex-1">
                        <Leaderboard rows={5} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full justify-center bg-bg px-10 pt-9 pb-8">
            <div className="flex w-full max-w-[1120px] flex-col gap-5">
                <ResultCard />
                <div className="flex flex-1 gap-6">
                    <div className="w-[440px] shrink-0">
                        <ChallengeCard variant={variant} />
                    </div>
                    <div className="flex-1">
                        <Leaderboard rows={5} />
                    </div>
                </div>
            </div>
        </div>
    );
}
