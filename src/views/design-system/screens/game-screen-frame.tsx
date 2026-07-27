import { clsx } from 'clsx';
import { BOT_NAME } from '@/shared/config';
import { Button, ChatBubble, DEMO_WEAPONS, HPBar, Icon, PipRow, WeaponSelector } from '@/shared/ui';
import { ArenaPlaceholder } from './arena-placeholder';
import { noop } from './_demo';
import type { TScreenVariant } from './frameset';

/** 5 снарядов на танк, 2 израсходовано; 4 хода на манёвр, 2 потрачено (GDD §1.1, §2.3). */
const SHELL_PIPS = [true, true, true, false, false];
const MOVE_PIPS = [true, true, false, false];

const TELEMETRY = [
    { label: 'Угол', value: '47°' },
    { label: 'Сила', value: '064' },
    { label: 'Ветер', value: '0.006' },
];

function TelemetryNumbers({ compact }: { compact: boolean }) {
    return (
        <div className={clsx('flex gap-4', compact && 'gap-3')}>
            {TELEMETRY.map((item) => (
                <div key={item.label} className="flex flex-col">
                    <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                        {item.label}
                    </span>
                    <span
                        className={clsx(
                            'font-ui font-bold text-text tabular-nums [text-shadow:var(--glow-text)]',
                            compact ? 'text-hud' : 'text-hud-xl',
                        )}
                    >
                        {item.value}
                    </span>
                </div>
            ))}
        </div>
    );
}

function TurnIndicator() {
    return (
        <div className="flex items-center gap-2 border-[length:var(--border-w)] border-[color:var(--accent)] bg-surface px-3 py-1.5 shadow-[var(--glow)]">
            <Icon name="target" size={14} className="text-[color:var(--accent)]" />
            <span className="font-ui text-label font-bold tracking-[0.14em] text-[color:var(--accent)] uppercase">
                Твой ход
            </span>
        </div>
    );
}

function AmmoPips({ column }: { column: boolean }) {
    return (
        <div className={clsx('flex gap-3', column ? 'flex-col' : 'items-center')}>
            <div className="flex items-center gap-2">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Снаряды
                </span>
                <PipRow pips={SHELL_PIPS} label="снарядов" />
            </div>
            <div className="flex items-center gap-2">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Ходы
                </span>
                <PipRow pips={MOVE_PIPS} color="var(--color-warning)" label="ходов манёвра" />
            </div>
        </div>
    );
}

function HudActions() {
    return (
        <div className="flex gap-2">
            <Button variant="ghost" size="icon" aria-label="Выключить звук" className="m-0">
                <Icon name="sound" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Пауза" className="m-0">
                <Icon name="pause" />
            </Button>
        </div>
    );
}

function BattleArena({ className }: { className?: string }) {
    return (
        <ArenaPlaceholder className={clsx('flex-1', className)}>
            {/* Позиционирует обёртка: у самого ChatBubble класс `relative`, и он бы
                перебил `absolute` (Tailwind решает порядком в CSS, а не в className). */}
            <div className="absolute top-4 right-6">
                <ChatBubble
                    faction="enemy"
                    speaker={BOT_NAME}
                    message="Ветер сегодня твой враг, новобранец."
                />
            </div>
        </ArenaPlaceholder>
    );
}

/** Тач-контролы «под большой палец» — только мобилка/планшет: на десктопе
 *  управление уходит на мышь/стрелки (GDD §1.1), рогатка и кнопки скрываются. */
function ThumbControls() {
    return (
        <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-2">
                <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                    Манёвр
                </span>
                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" aria-label="Сдвинуть влево" className="m-0">
                        <Icon name="arrow-l" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Сдвинуть вправо"
                        className="m-0"
                        disabled
                    >
                        <Icon name="arrow-r" />
                    </Button>
                </div>
            </div>
            <div className="w-[42%]">
                <WeaponSelector
                    weapons={DEMO_WEAPONS}
                    selectedIndex={0}
                    onPrev={noop}
                    onNext={noop}
                />
            </div>
            <Button variant="primary" className="m-0 size-20 shrink-0 flex-col gap-1 text-[13px]">
                <Icon name="fire" size={22} />
                Огонь
            </Button>
        </div>
    );
}

export function GameScreenFrame({ variant }: { variant: TScreenVariant }) {
    if (variant === 'mobile') {
        return (
            <div className="flex h-full w-full flex-col gap-3 bg-bg px-3 pt-4 pb-6">
                <div className="flex flex-col gap-2.5 border-[length:var(--border-w)] border-border bg-panel px-3 py-2.5">
                    <div className="flex items-center justify-between">
                        <TurnIndicator />
                        <HudActions />
                    </div>
                    <div className="flex flex-col gap-2">
                        <HPBar label="Rex Commander" value={72} faction="player" />
                        <HPBar label={BOT_NAME} value={38} faction="enemy" />
                    </div>
                    <div className="flex items-end justify-between">
                        <TelemetryNumbers compact />
                        <AmmoPips column />
                    </div>
                </div>
                <BattleArena />
                <ThumbControls />
            </div>
        );
    }

    if (variant === 'tablet') {
        return (
            <div className="flex h-full w-full flex-col gap-4 bg-bg px-6 pt-5 pb-6">
                <div className="flex items-center gap-6 border-[length:var(--border-w)] border-border bg-panel px-5 py-3">
                    <div className="flex w-[40%] flex-col gap-2">
                        <HPBar label="Rex Commander" value={72} faction="player" />
                        <HPBar label={BOT_NAME} value={38} faction="enemy" />
                    </div>
                    <TelemetryNumbers compact />
                    <div className="ml-auto flex items-center gap-4">
                        <TurnIndicator />
                        <HudActions />
                    </div>
                </div>
                <AmmoPips column={false} />
                <BattleArena />
                <ThumbControls />
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col gap-5 bg-bg px-10 pt-6 pb-8">
            <div className="flex items-center gap-8 border-[length:var(--border-w)] border-border bg-panel px-6 py-3">
                <div className="flex w-[30%] flex-col gap-2">
                    <HPBar label="Rex Commander" value={72} faction="player" />
                    <HPBar label={BOT_NAME} value={38} faction="enemy" />
                </div>
                <TelemetryNumbers compact={false} />
                <AmmoPips column={false} />
                <div className="ml-auto flex items-center gap-4">
                    <TurnIndicator />
                    <HudActions />
                </div>
            </div>
            <div className="flex flex-1 gap-6">
                <BattleArena />
                <div className="flex w-[300px] shrink-0 flex-col gap-4">
                    <WeaponSelector
                        weapons={DEMO_WEAPONS}
                        selectedIndex={0}
                        onPrev={noop}
                        onNext={noop}
                    />
                    <div className="flex flex-col gap-2 border-[length:var(--border-w)] border-border bg-panel p-4">
                        <span className="font-ui text-label tracking-[0.14em] text-text-muted uppercase">
                            Управление
                        </span>
                        <span className="font-ui text-caption text-text-muted">
                            Мышь и стрелки — угол, колесо — сила, Ctrl + стрелки — оружие.
                            Тач-рогатка скрыта.
                        </span>
                    </div>
                    <Button variant="primary" className="m-0 gap-2">
                        <Icon name="fire" size={18} />
                        Огонь
                    </Button>
                </div>
            </div>
        </div>
    );
}
