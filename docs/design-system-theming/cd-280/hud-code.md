# Код HUD: эталон витрины vs боевой экран (для контекста Claude Design)

## 1. shared/ui — что уже сверстано (public API)

```ts
export { Button, buttonClasses } from './button';
export type { TButtonVariant, TButtonSize } from './button';
export { ShareButton } from './share-button/share-button';
export { Panel } from './panel';
export { Select } from './select';
export { SegmentedControl } from './segmented-control';
export type { TSegmentedControlOption } from './segmented-control';
export { TextInput } from './text-input';
export { Toggle } from './toggle';
export { Dialog } from './dialog';
export { ICON_NAMES, Icon } from './icon';
export type { TIconName } from './icon';
export { Avatar } from './avatar';
export type { TAvatarFaction } from './avatar';
export { FactionBadge } from './faction-badge';
export type { TFactionBadgeFaction, TFactionBadgeSize } from './faction-badge';
export { HPBar } from './hp-bar';
export type { THPBarFaction } from './hp-bar';
export { PipRow } from './pip-row';
export { WeaponSelector, DEMO_WEAPONS } from './weapon-selector';
export type { TWeaponSelectorWeapon } from './weapon-selector';
export { ChatBubble } from './chat-bubble';
export type { TChatBubbleFaction } from './chat-bubble';
export { Toast } from './toast';
export type { TToastVariant } from './toast';
export { Skeleton } from './skeleton';
export { EmptyState } from './empty-state';
export { ErrorBanner } from './error-banner';
export { Spinner } from './spinner';
```

## 2. Эталон-кадр витрины: src/views/design-system/screens/game-screen-frame.tsx

```tsx
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
```

## 3. Боевой экран (легаси): src/views/game-page/game-page.tsx

```tsx
import Link from 'next/link';
import { GameCanvas } from '@/features/game-engine';
import { SceneMusic } from '@/shared/lib/audio';
import { Icon } from '@/shared/ui';
import { GameControls } from '@/widgets/game-controls';
import { GameOverDialog } from '@/widgets/game-over-dialog';

type TGamePageProps = {
    seed?: string;
};

export function GamePage({ seed }: TGamePageProps = {}) {
    return (
        <main className="safe-area-inset flex h-dvh flex-col overflow-hidden">
            <SceneMusic track="battle" />
            <div className="relative flex-1 overflow-hidden">
                <GameCanvas seed={seed} />
            </div>
            <div data-testid="game-hud" className="border-t border-border bg-panel">
                <GameControls />
            </div>
            <GameOverDialog seed={seed} />
            <Link
                href="/design-system"
                aria-label="Витрина компонентов"
                style={{
                    top: 'max(1rem, env(safe-area-inset-top))',
                    right: 'max(1rem, env(safe-area-inset-right))',
                }}
                className="fixed z-40 flex min-h-11 min-w-11 items-center justify-center rounded-sm bg-panel-raised text-text-muted opacity-50 transition-all hover:text-primary hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary"
            >
                {/* `eye` (смотреть/витрина), а не `settings`-шестерёнка: ссылка ведёт в
                    каталог-витрину компонентов, а не в настройки — иконка не должна врать
                    зрячему (для SR она декоративна, `aria-hidden`; смысл несёт aria-label). */}
                <Icon name="eye" size={16} />
            </Link>
        </main>
    );
}
```

## 4. Боевой HUD (легаси): src/widgets/game-controls/ui/game-controls.tsx

```tsx
'use client';

import { useGameStore } from '@/features/game-engine';
import { BOT_NAME } from '@/shared/config';
import { useMuteState } from '@/shared/lib/audio';
import { useAnimatedValue } from '@/shared/lib/animation';
import { Button, Icon, Select } from '@/shared/ui';
import { useHoldRepeat } from '../lib/use-hold-repeat';
import { KeyboardSchemeHint } from './keyboard-scheme-hint';

const noop = () => {};

const formatAngle = (radians: number) => {
    const normalized = radians < 0 ? -radians : 2 * Math.PI - radians;

    return ((normalized * 180) / Math.PI) | 0;
};

export function GameControls() {
    const power = useGameStore((s) => s.power);
    const angle = useGameStore((s) => s.angle);
    const moves = useGameStore((s) => s.moves);
    const playerPoints = useGameStore((s) => s.playerPoints);
    const enemyPoints = useGameStore((s) => s.enemyPoints);
    const weapons = useGameStore((s) => s.weapons);
    const selectedWeapon = useGameStore((s) => s.selectedWeapon);

    const increaseAngle = useGameStore((s) => s.increaseAngle);
    const increasePower = useGameStore((s) => s.increasePower);
    const selectWeapon = useGameStore((s) => s.selectWeapon);

    const { isMuted, toggle: toggleMute } = useMuteState();

    // Счёт и ходы обновляются в сторе скачком (попадание, ход) — HUD плавно
    // дотягивает отображаемое число к нему, а не дёргается мгновенно.
    const displayedPlayerPoints = Math.round(useAnimatedValue(playerPoints));
    const displayedEnemyPoints = Math.round(useAnimatedValue(enemyPoints));
    const displayedMoves = Math.round(useAnimatedValue(moves));

    return (
        <div className="flex flex-col gap-2 p-2 sm:gap-4 sm:p-4">
            <div className="flex items-center justify-end">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Включить звук' : 'Выключить звук'}
                    title={isMuted ? 'Включить звук' : 'Выключить звук'}
                >
                    <Icon name={isMuted ? 'mute' : 'sound'} />
                </Button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-4">
                <div className="flex flex-col items-center gap-2">
                    <div className="font-ui text-xs text-text-muted">Игрок</div>
                    <div className="font-ui text-hud-xl text-primary tabular-nums [text-shadow:var(--glow-text)]">
                        {displayedPlayerPoints}
                    </div>
                </div>

                <div className="flex flex-wrap items-end justify-center gap-2 sm:gap-4">
                    <Counter
                        label="Мощность"
                        value={power}
                        onDec={() => increasePower(-1)}
                        onInc={() => increasePower(1)}
                    />
                    <Counter
                        label="Угол"
                        value={formatAngle(angle)}
                        onDec={() => increaseAngle(Math.PI / 180)}
                        onInc={() => increaseAngle(-Math.PI / 180)}
                    />
                    <Select
                        id="weapon-select"
                        label="Оружие"
                        className="w-36"
                        value={selectedWeapon?.id ?? ''}
                        onValueChange={(value) => {
                            const next = weapons.find((w) => w.id === Number(value));
                            if (next) selectWeapon(next);
                        }}
                    >
                        {weapons.map((w) => (
                            <option key={w.id} value={w.id}>
                                {w.name} #{w.id}
                            </option>
                        ))}
                    </Select>
                    <Counter label="Ходы" value={displayedMoves} />
                </div>

                <div className="flex flex-col items-center gap-2">
                    <div className="font-ui text-xs text-text-muted">{BOT_NAME}</div>
                    <div className="font-ui text-hud-xl text-danger tabular-nums [text-shadow:var(--glow-text)]">
                        {displayedEnemyPoints}
                    </div>
                </div>
            </div>

            <div className="border-t border-border pt-2 sm:pt-4">
                <KeyboardSchemeHint />
            </div>
        </div>
    );
}

type TCounterProps = {
    label: string;
    value: number | string;
    onDec?: () => void;
    onInc?: () => void;
};

function Counter({ label, value, onDec, onInc }: TCounterProps) {
    // Удержание кнопки авто-повторяет шаг — набирать значение по одному тыку было
    // долго (#264). Counter общий: hold работает и для «Мощности», и для «Угла».
    // Для угла это паритет с авто-репитом стрелок; угол в сторе не заворачивается
    // по 2π, так что долгим удержанием HUD покажет градусы вне 0..360 — косметика
    // (физика периодична по cos/sin), нормализацию не трогаем в рамках #264.
    // `useHoldRepeat` владеет и onClick — тап/клавиатура дают ровно один шаг.
    const decHold = useHoldRepeat(onDec ?? noop);
    const incHold = useHoldRepeat(onInc ?? noop);

    return (
        <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-text-muted">{label}</span>
            <div className="flex items-center gap-2">
                <Button
                    variant="ghost"
                    size="icon"
                    disabled={!onDec}
                    aria-label={`${label} меньше`}
                    {...decHold}
                >
                    −
                </Button>
                <span className="min-w-[3rem] text-center font-ui text-sm tabular-nums">
                    {value}
                </span>
                <Button
                    variant="ghost"
                    size="icon"
                    disabled={!onInc}
                    aria-label={`${label} больше`}
                    {...incHold}
                >
                    +
                </Button>
            </div>
        </div>
    );
}
```
