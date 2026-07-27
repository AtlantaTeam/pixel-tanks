import { clsx } from 'clsx';
import { Avatar, Button, Icon } from '@/shared/ui';
import type { TScreenVariant } from './frameset';

type TStat = {
    label: string;
    value: string;
    hint: string;
    /** Стрик боёв дня — ключевая метрика возврата, красится в primary + glow-primary. */
    highlight?: boolean;
};

const STATS: TStat[] = [
    { label: 'Винрейт', value: '64%', hint: '82 победы из 128' },
    { label: 'Точность', value: '41%', hint: '210 попаданий / 512' },
    { label: 'Лучший счёт', value: '87', hint: 'остаток HP в победе' },
    { label: 'Стрик', value: '5', hint: 'боёв дня подряд', highlight: true },
];

type TBattle = {
    date: string;
    mode: string;
    victory: boolean;
    hp: string;
    difficulty: string;
};

const BATTLES: TBattle[] = [
    { date: '27.07', mode: 'Бой дня', victory: true, hp: '62', difficulty: 'Терминатор' },
    { date: '26.07', mode: 'Быстрый бой', victory: true, hp: '18', difficulty: 'Стрелок' },
    { date: '26.07', mode: 'Бой дня', victory: false, hp: '0', difficulty: 'Терминатор' },
    { date: '25.07', mode: 'Быстрый бой', victory: true, hp: '87', difficulty: 'Новобранец' },
    { date: '24.07', mode: 'Бой дня', victory: false, hp: '0', difficulty: 'Стрелок' },
];

function StatCard({ label, value, hint, highlight }: TStat) {
    return (
        <div
            className={clsx(
                'flex flex-col gap-1 border-[length:var(--border-w)] bg-panel px-4 py-3',
                highlight ? 'border-primary shadow-[var(--glow-primary)]' : 'border-border',
            )}
        >
            <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                {label}
            </span>
            <span
                className={clsx(
                    'font-ui text-hud-xl font-bold tabular-nums',
                    highlight ? 'text-primary' : 'text-text',
                )}
            >
                {value}
            </span>
            <span className="font-ui text-label text-text-dim">{hint}</span>
        </div>
    );
}

function BattleRow({ battle, compact }: { battle: TBattle; compact: boolean }) {
    const outcome = (
        <span
            className={clsx(
                'font-ui text-caption font-bold uppercase',
                battle.victory ? 'text-accent' : 'text-danger',
            )}
        >
            {battle.victory ? 'Победа' : 'Поражение'}
        </span>
    );

    if (compact) {
        return (
            <div className="grid grid-cols-[52px_1fr_96px_64px_100px_120px] items-center gap-3 border-[length:var(--border-w)] border-border bg-panel px-4 py-2.5">
                <span className="font-ui text-caption text-text-muted tabular-nums">
                    {battle.date}
                </span>
                <span className="font-ui text-caption text-text">{battle.mode}</span>
                {outcome}
                <span className="font-ui text-caption text-text-muted tabular-nums">
                    HP {battle.hp}
                </span>
                <span className="font-ui text-label text-text-dim">{battle.difficulty}</span>
                <Button variant="ghost" size="sm" className="m-0 gap-1.5">
                    <Icon name="replay" size={13} />
                    Реплей
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 border-[length:var(--border-w)] border-border bg-panel px-4 py-3">
            <div className="flex items-center justify-between">
                <span className="font-ui text-caption text-text">{battle.mode}</span>
                {outcome}
            </div>
            <div className="flex items-center justify-between">
                <span className="font-ui text-label text-text-muted tabular-nums">
                    {battle.date} · HP {battle.hp} · {battle.difficulty}
                </span>
                <Button variant="ghost" size="sm" className="m-0 gap-1.5">
                    <Icon name="replay" size={13} />
                    Реплей
                </Button>
            </div>
        </div>
    );
}

function ProfileHeader({ stacked }: { stacked: boolean }) {
    return (
        <div className={clsx('flex gap-4', stacked ? 'flex-col' : 'items-center')}>
            <Avatar faction="player" icon={<Icon name="star" size={28} />} />
            <div className="flex flex-col gap-1">
                <span className="font-display text-h2 text-text uppercase">Rex Commander</span>
                <span className="font-ui text-caption text-text-muted">
                    В строю с 12.03.2026 · фракция «Зелёные»
                </span>
            </div>
        </div>
    );
}

function ProfileActions({ full }: { full: boolean }) {
    return (
        <div className="flex gap-2">
            <Button variant="primary" className={clsx('m-0', full && 'flex-1')}>
                Играть
            </Button>
            <Button variant="ghost" className="m-0 gap-1.5">
                <Icon name="settings" size={14} />
                Настройки
            </Button>
            <Button variant="ghost" className="m-0">
                Выход
            </Button>
        </div>
    );
}

function BattleHistory({ compact, rows }: { compact: boolean; rows: number }) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    История боёв
                </span>
                <span className="font-ui text-label text-text-dim">
                    128 боёв · реплей у каждого
                </span>
            </div>
            {BATTLES.slice(0, rows).map((battle) => (
                <BattleRow
                    key={`${battle.date}-${battle.mode}`}
                    battle={battle}
                    compact={compact}
                />
            ))}
        </div>
    );
}

export function ProfileScreenFrame({ variant }: { variant: TScreenVariant }) {
    if (variant === 'mobile') {
        return (
            <div className="flex h-full w-full flex-col gap-4 bg-bg px-4 pt-6 pb-6">
                <ProfileHeader stacked />
                <div className="grid grid-cols-2 gap-2">
                    {STATS.map((stat) => (
                        <StatCard key={stat.label} {...stat} />
                    ))}
                </div>
                <BattleHistory compact={false} rows={2} />
                <ProfileActions full />
            </div>
        );
    }

    if (variant === 'tablet') {
        return (
            <div className="flex h-full w-full flex-col gap-5 bg-bg px-8 pt-8 pb-6">
                <div className="flex items-center justify-between">
                    <ProfileHeader stacked={false} />
                    <ProfileActions full={false} />
                </div>
                <div className="grid grid-cols-4 gap-2">
                    {STATS.map((stat) => (
                        <StatCard key={stat.label} {...stat} />
                    ))}
                </div>
                <BattleHistory compact rows={4} />
            </div>
        );
    }

    return (
        <div className="flex h-full w-full justify-center bg-bg px-10 pt-10 pb-8">
            <div className="flex w-full max-w-[1120px] gap-8">
                <div className="flex w-[360px] shrink-0 flex-col gap-5">
                    <ProfileHeader stacked />
                    <div className="grid grid-cols-2 gap-2">
                        {STATS.map((stat) => (
                            <StatCard key={stat.label} {...stat} />
                        ))}
                    </div>
                    <ProfileActions full />
                </div>
                <div className="flex-1">
                    <BattleHistory compact rows={5} />
                </div>
            </div>
        </div>
    );
}
