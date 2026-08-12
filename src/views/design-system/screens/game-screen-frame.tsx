import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { MOVE_BUDGET, WEAPONS_AMOUNT, WIND_DISPLAY_SCALE } from '@/features/game-engine';
import { BOT_NAME, MAX_HP } from '@/shared/config';
import { ThemeScope } from '@/shared/lib/theme';
import { Button, ChatBubble, HPBar, Icon, PipRow, Toast, WeaponSelector } from '@/shared/ui';
import { ArenaPlaceholder } from './arena-placeholder';
import { noop } from './_demo';
import type { TScreenVariant } from './frameset';

/**
 * Состояния боевого экрана (handoff «Взаимодействия и состояния»): пять
 * визуально различимых срезов, показанных на витрине (issue #427). `over`
 * (game over) сюда не входит — он уже 1:1 покрыт `GameOverSection` (§13),
 * дублировать диалог здесь незачем.
 */
export type TGameScreenState = 'player-turn' | 'bot-turn' | 'aiming' | 'empty-ammo' | 'calm';

/** Контраст над любым скином (handoff, решение E) — та же строка, что в реальных
 *  `widgets/top-hud` и `widgets/game-controls`: подложка + blur держат читаемость
 *  HUD-элементов поверх шумной/светлой арены независимо от арта. */
const HUD_SURFACE = 'bg-[rgba(8,12,8,0.80)] backdrop-blur-[4px] shadow-[0_0_0_1px_rgba(0,0,0,.9)]';

/** Снарядов на танк — половина общего арсенала боя (см. `dealWeapons`), как в `widgets/top-hud`. */
const AMMO_TOTAL = WEAPONS_AMOUNT / 2;

type TSceneData = {
    isBotTurn: boolean;
    isAiming: boolean;
    isEmptyAmmo: boolean;
    isCalm: boolean;
    turnLabel: string;
    ammoActive: number;
    movesActive: number;
};

function sceneDataFor(state: TGameScreenState): TSceneData {
    const isBotTurn = state === 'bot-turn';
    const isEmptyAmmo = state === 'empty-ammo';

    return {
        isBotTurn,
        isAiming: state === 'aiming',
        isEmptyAmmo,
        isCalm: state === 'calm',
        turnLabel: isBotTurn ? 'ХОД СОПЕРНИКА' : 'ТВОЙ ХОД',
        ammoActive: isEmptyAmmo ? 0 : 3,
        movesActive: 2,
    };
}

function HpCard({
    faction,
    label,
    value,
    active,
    layout = 'stacked',
}: {
    faction: 'player' | 'enemy';
    label: string;
    value: number;
    active: boolean;
    layout?: 'stacked' | 'inline';
}) {
    return (
        <div
            className={clsx(
                HUD_SURFACE,
                'min-w-[150px] flex-1 border-[length:var(--border-w)]',
                layout === 'inline' ? 'px-2 py-1.5' : 'p-2',
                active
                    ? faction === 'player'
                        ? 'border-accent shadow-[var(--glow-accent),0_0_0_1px_rgba(0,0,0,.9)]'
                        : 'border-enemy shadow-[var(--glow-enemy),0_0_0_1px_rgba(0,0,0,.9)]'
                    : 'border-border',
            )}
        >
            <HPBar label={label} value={value} faction={faction} max={MAX_HP} layout={layout} />
        </div>
    );
}

function TurnPill({ label }: { label: string }) {
    return (
        <div
            className={clsx(
                HUD_SURFACE,
                'flex min-h-10 shrink-0 items-center gap-2 border-[length:var(--border-w)] border-[color:var(--accent)] px-3 py-2 shadow-[var(--glow)]',
            )}
        >
            <span aria-hidden className="size-2 shrink-0 bg-[color:var(--accent)]" />
            <span className="font-display text-[13px] tracking-[0.08em] whitespace-nowrap text-[color:var(--accent)] uppercase [text-shadow:var(--glow)]">
                {label}
            </span>
        </div>
    );
}

function HudIconButtons() {
    return (
        <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="icon" className="m-0" aria-label="Выключить звук">
                <Icon name="sound" />
            </Button>
            <Button variant="ghost" size="icon" className="m-0" aria-label="Пауза">
                <Icon name="pause" />
            </Button>
        </div>
    );
}

function CellShell({
    label,
    compact,
    children,
}: {
    label: string;
    compact?: boolean;
    children: ReactNode;
}) {
    return (
        <div
            className={clsx(
                HUD_SURFACE,
                'flex flex-col gap-0.5 border-[length:var(--border-w)] border-border',
                compact ? 'shrink-0 px-1 py-0.5' : 'px-2.5 py-1.5',
            )}
        >
            <span className="font-ui text-[9px] tracking-[0.14em] text-text-muted uppercase">
                {label}
            </span>
            {children}
        </div>
    );
}

function CellValue({
    compact,
    valueClassName,
    children,
}: {
    compact?: boolean;
    valueClassName: string;
    children: ReactNode;
}) {
    return (
        <span
            className={clsx(
                'font-ui font-bold tabular-nums [text-shadow:var(--glow-text)]',
                compact ? 'text-[18px]' : 'text-hud-xl',
                valueClassName,
            )}
        >
            {children}
        </span>
    );
}

function NumberCell({
    label,
    value,
    valueClassName,
}: {
    label: string;
    value: ReactNode;
    valueClassName: string;
}) {
    return (
        <CellShell label={label}>
            <CellValue valueClassName={valueClassName}>{value}</CellValue>
        </CellShell>
    );
}

/** Компактная тач-кнопка ± (#450): визуально 32px, зона нажатия ≥44×44
 *  псевдоэлементом. 1:1 с боевым `TrimButton` в `widgets/top-hud`. */
function TrimButton({
    ariaLabel,
    disabled,
    children,
}: {
    ariaLabel: string;
    disabled: boolean;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={noop}
            disabled={disabled}
            aria-label={ariaLabel}
            className={clsx(
                'relative flex size-8 shrink-0 cursor-pointer items-center justify-center',
                'border-[length:var(--border-w)] border-border-strong bg-panel-raised text-text',
                'font-ui text-base leading-none uppercase',
                'transition-colors hover:border-[color:var(--accent)]',
                'focus-visible:border-[color:var(--accent)] focus-visible:outline-none',
                'active:translate-y-0.5',
                'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted disabled:text-text-dim',
                "before:absolute before:-inset-2.5 before:content-['']",
            )}
        >
            {children}
        </button>
    );
}

/** УГОЛ/СИЛА на тач-мобилке (handoff, решение B): ± вокруг значения — доводка
 *  после жеста рогатки. Компактная плотность (#450): кнопки визуально 32px
 *  (тач-цель ≥44). На витрине декоративные (`noop`), но визуально 1:1 с боевой. */
function TrimCell({
    label,
    value,
    valueClassName,
    frozen,
}: {
    label: string;
    value: ReactNode;
    valueClassName: string;
    frozen: boolean;
}) {
    return (
        <CellShell label={label} compact>
            <div className="flex items-center gap-0.5">
                <TrimButton ariaLabel={`${label} меньше`} disabled={frozen}>
                    −
                </TrimButton>
                <CellValue compact valueClassName={valueClassName}>
                    {value}
                </CellValue>
                <TrimButton ariaLabel={`${label} больше`} disabled={frozen}>
                    +
                </TrimButton>
            </div>
        </CellShell>
    );
}

/** Ветер до пристрелки (handoff «Ветер», вердикт п.18): стрелка + пипы грубой
 *  силы, точное число не показываем — раскрытие живёт после первого выстрела
 *  (`windRevealed`), которого статичная витрина не моделирует. */
function WindCell({ compact }: { compact?: boolean }) {
    const magnitude = 2;
    const pips = Array.from({ length: WIND_DISPLAY_SCALE }, (_, index) => index < magnitude);

    return (
        <CellShell label="Ветер" compact={compact}>
            <div className={clsx('flex items-center', compact ? 'gap-1' : 'gap-1.5')}>
                <Icon name="arrow-r" size={compact ? 14 : 18} className="text-warning" />
                <PipRow
                    pips={pips}
                    color="var(--color-warning)"
                    size={compact ? 8 : 10}
                    gap={compact ? 3 : 5}
                    label="грубая сила ветра"
                />
            </div>
        </CellShell>
    );
}

function ResourcePips({
    label,
    pips,
    color,
    ariaLabel,
    size,
    gap,
}: {
    label: string;
    pips: boolean[];
    color: string;
    ariaLabel: string;
    size?: number;
    gap?: number;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="font-ui text-[9px] tracking-[0.14em] text-text-muted uppercase">
                {label}
            </span>
            <PipRow pips={pips} color={color} label={ariaLabel} size={size} gap={gap} />
        </div>
    );
}

function FrozenNote({ className }: { className?: string }) {
    return (
        <p
            className={clsx(
                HUD_SURFACE,
                'border-[length:var(--border-w)] border-border px-2.5 py-1.5 font-ui text-[10px] text-text-muted uppercase',
                className,
            )}
        >
            Твои числа заморожены до конца хода соперника
        </p>
    );
}

/** Лок ввода палубы (handoff «Лок ввода», ход бота) — та же оболочка, что и
 *  боевой `DeckLock`: блюр + затемнение поверх всей палубы. */
function DeckLockOverlay({ label }: { label: string }) {
    return (
        <div
            aria-hidden
            className={clsx(
                'pointer-events-auto absolute inset-0 z-10 flex flex-col items-center justify-center gap-2',
                'bg-[rgba(8,12,8,0.88)] backdrop-blur-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.9)]',
            )}
        >
            <span
                aria-hidden
                className="size-2.5 animate-lock-blink bg-[color:var(--accent)] motion-reduce:animate-none"
            />
            <span className="font-display text-[15px] tracking-[0.08em] text-[color:var(--accent)] uppercase [text-shadow:var(--glow)]">
                {label}
            </span>
        </div>
    );
}

function AmmoEmptyToastRow() {
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-2 flex justify-center px-2.5">
            <Toast
                variant="warning"
                message="Патроны кончились — остался только манёвр. Ход перейдёт сопернику."
                className="max-w-sm"
            />
        </div>
    );
}

/** Визуал жеста «оттяни-отпусти» (handoff «Прицеливание») — луч + кольцо пальца +
 *  чип предпросмотра, статичная позиция в процентах арены (реальный
 *  `GestureOverlay` живёт в `features/game-engine` и координатится пикселями
 *  канваса — здесь арена лишь плейсхолдер, поэтому позиция фиксирована в %,
 *  а не портируется расчёт `lib/gesture-aim.ts`). */
function AimGestureDemo() {
    const origin = { x: '34%', y: '40%' };
    const finger = { x: '16%', y: '62%' };

    return (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
            <svg
                className="absolute inset-0 h-full w-full overflow-visible"
                style={{ filter: 'drop-shadow(0 0 6px var(--color-accent))' }}
            >
                <line
                    x1={origin.x}
                    y1={origin.y}
                    x2={finger.x}
                    y2={finger.y}
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                />
            </svg>
            <span
                className="absolute size-2 -translate-x-1/2 -translate-y-1/2 bg-accent"
                style={{ left: origin.x, top: origin.y }}
            />
            <div
                className="absolute size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-accent opacity-70"
                style={{ left: finger.x, top: finger.y }}
            />
            <div
                className={clsx(
                    HUD_SURFACE,
                    'absolute w-[168px] -translate-x-1/2 border-[length:var(--border-w)] border-accent px-3 py-2 text-center',
                )}
                style={{ left: finger.x, top: '48%' }}
            >
                <div className="flex items-baseline justify-center gap-2 font-ui font-bold text-accent tabular-nums [text-shadow:var(--glow-text)]">
                    <span className="text-[22px] leading-none">
                        47<span className="text-[13px]">°</span>
                    </span>
                    <span className="text-[22px] leading-none text-warning">064</span>
                </div>
                <span className="font-ui text-[9px] font-bold tracking-[0.12em] text-text-muted uppercase">
                    Отпусти — выстрел
                </span>
            </div>
        </div>
    );
}

/** Обёртка `absolute inset-0` СНАРУЖИ `ArenaPlaceholder`, не через её `className`:
 *  у самого компонента уже есть `relative` в собственной разметке, и слитый в
 *  один className `absolute` проиграл бы ему (Tailwind решает порядком в
 *  CSS, а не в className — тот же класс бага, что и у `ChatBubble` ниже). */
function BattleArena({ scene }: { scene: TSceneData }) {
    return (
        <div className="absolute inset-0">
            <ArenaPlaceholder className="size-full">
                {scene.isBotTurn && (
                    <div
                        data-testid="arena-turn-ring"
                        aria-hidden
                        className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_3px_var(--color-enemy),inset_0_0_40px_rgba(201,0,255,.28)]"
                    />
                )}
                {scene.isAiming && <AimGestureDemo />}
                {scene.isBotTurn && (
                    // top-[52%]: арена теперь `inset-0` во весь кадр (оверлейный HUD
                    // поверх неё, не сосед во flex-колонке, как в старой раскладке) —
                    // `top-4` здесь коллидировал бы с верхним HUD (мобильный оверлей на
                    // ходе бота растёт до ~330px за счёт `FrozenNote`), поэтому позиция
                    // ниже его блока, а не у самого верха арены.
                    <div className="absolute top-[52%] right-6">
                        <ChatBubble
                            faction="enemy"
                            speaker={BOT_NAME}
                            message="Ветер сегодня твой враг, новобранец."
                        />
                    </div>
                )}
            </ArenaPlaceholder>
        </div>
    );
}

function ManeuverButton({ direction }: { direction: 'left' | 'right' }) {
    return (
        <button
            type="button"
            onClick={noop}
            aria-label={direction === 'left' ? 'Сдвинуть влево' : 'Сдвинуть вправо'}
            className="flex h-16 w-14 shrink-0 cursor-pointer items-center justify-center border-[length:var(--border-w)] border-border-strong bg-panel-raised text-text transition-colors hover:border-[color:var(--accent)] focus-visible:border-[color:var(--accent)] focus-visible:outline-none"
        >
            <Icon name={direction === 'left' ? 'arrow-l' : 'arrow-r'} />
        </button>
    );
}

function FireButton({
    disabled,
    hint,
    className,
}: {
    disabled: boolean;
    hint: 'touch' | 'desktop';
    className?: string;
}) {
    const subtitle = disabled
        ? 'нет снарядов'
        : hint === 'desktop'
          ? 'space'
          : 'повторить 47° · 064';

    return (
        <button
            type="button"
            onClick={noop}
            disabled={disabled}
            aria-label={disabled ? 'Огонь — нет снарядов' : 'Огонь: угол 47°, сила 64'}
            className={clsx(
                'flex min-h-16 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 uppercase transition-[filter] active:translate-y-0.5 disabled:cursor-not-allowed',
                disabled
                    ? 'bg-muted text-text-dim shadow-none'
                    : 'bg-primary text-primary-ink shadow-[var(--edge-pixel),var(--glow-primary)]',
                className,
            )}
        >
            <span className="font-display text-[20px] tracking-[0.12em]">Огонь</span>
            <span className="text-[9px] tracking-normal opacity-75">{subtitle}</span>
        </button>
    );
}

function GestureHint({ className }: { className?: string }) {
    return (
        <p
            className={clsx(
                HUD_SURFACE,
                'border-[length:var(--border-w)] border-border px-2.5 py-1.5 text-center font-ui text-[10px] text-text-muted uppercase',
                className,
            )}
        >
            Тяни по арене — отпусти, чтобы выстрелить
        </p>
    );
}

function WeaponDeckSlot({ ammo }: { ammo: number }) {
    return (
        <WeaponSelector
            weapons={[{ name: 'Снаряд', icon: 'fire', ammo }]}
            selectedIndex={0}
            onPrev={noop}
            onNext={noop}
        />
    );
}

function TopHudOverlay({ scene, variant }: { scene: TSceneData; variant: TScreenVariant }) {
    const ammoPips = Array.from({ length: AMMO_TOTAL }, (_, index) => index < scene.ammoActive);
    const movePips = Array.from({ length: MOVE_BUDGET }, (_, index) => index < scene.movesActive);
    const telemetryClassName = clsx('flex items-center gap-4', scene.isBotTurn && 'opacity-60');

    if (variant === 'mobile') {
        return (
            <div
                className="pointer-events-none absolute inset-x-0 top-0 z-6 flex flex-col gap-2 p-2.5"
                style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top))' }}
            >
                <div className="pointer-events-auto flex flex-col gap-1.5">
                    <div className="flex gap-2">
                        <HpCard
                            faction="player"
                            label="Rex Commander"
                            value={72}
                            active={!scene.isBotTurn}
                            layout="inline"
                        />
                        <HpCard
                            faction="enemy"
                            label={BOT_NAME}
                            value={38}
                            active={scene.isBotTurn}
                            layout="inline"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <TurnPill label={scene.turnLabel} />
                        <div className="flex-1" />
                        <HudIconButtons />
                    </div>
                    {/* Вся телеметрия — один ряд (#450): угол / сила / ветер / пипы. */}
                    <div
                        className={clsx(
                            'relative flex items-stretch gap-1.5',
                            scene.isBotTurn && 'opacity-60',
                        )}
                    >
                        <TrimCell
                            label="Угол"
                            value="47°"
                            valueClassName="text-accent"
                            frozen={scene.isBotTurn}
                        />
                        <TrimCell
                            label="Сила"
                            value={64}
                            valueClassName="text-warning"
                            frozen={scene.isBotTurn}
                        />
                        <WindCell compact />
                        <div className="flex shrink-0 flex-col justify-center gap-1">
                            <ResourcePips
                                label="Снаряды"
                                pips={ammoPips}
                                color="var(--color-accent)"
                                ariaLabel="снарядов"
                                size={8}
                                gap={2}
                            />
                            <ResourcePips
                                label="Ходы"
                                pips={movePips}
                                color="var(--color-warning)"
                                ariaLabel="ходов манёвра"
                                size={8}
                                gap={2}
                            />
                        </div>
                        {scene.isBotTurn && (
                            <FrozenNote className="pointer-events-none absolute inset-x-0 bottom-0" />
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (variant === 'tablet') {
        return (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-6">
                <div className="pointer-events-auto flex w-full flex-col gap-3 border-b-[length:var(--border-w)] border-border bg-panel px-4 py-3">
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex min-w-[420px] flex-1 gap-2">
                            <HpCard
                                faction="player"
                                label="Rex Commander"
                                value={72}
                                active={!scene.isBotTurn}
                            />
                            <HpCard
                                faction="enemy"
                                label={BOT_NAME}
                                value={38}
                                active={scene.isBotTurn}
                            />
                        </div>
                        <TurnPill label={scene.turnLabel} />
                        <HudIconButtons />
                    </div>
                    <div
                        className={clsx(
                            'flex w-full flex-wrap items-center gap-4',
                            telemetryClassName,
                        )}
                    >
                        <NumberCell label="Угол" value="47°" valueClassName="text-accent" />
                        <NumberCell label="Сила" value={64} valueClassName="text-warning" />
                        <WindCell />
                        <ResourcePips
                            label="Снаряды"
                            pips={ammoPips}
                            color="var(--color-accent)"
                            ariaLabel="снарядов"
                        />
                        <ResourcePips
                            label="Ходы"
                            pips={movePips}
                            color="var(--color-warning)"
                            ariaLabel="ходов манёвра"
                        />
                        {scene.isBotTurn && <FrozenNote className="w-full" />}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-6">
            <div className="pointer-events-auto mx-auto flex h-[78px] max-w-[1280px] items-center gap-5 border-b-[length:var(--border-w)] border-border bg-panel px-4">
                <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-4">
                    <div className="flex min-w-0 flex-1 gap-2">
                        <HpCard
                            faction="player"
                            label="Rex Commander"
                            value={72}
                            active={!scene.isBotTurn}
                        />
                        <HpCard
                            faction="enemy"
                            label={BOT_NAME}
                            value={38}
                            active={scene.isBotTurn}
                        />
                    </div>
                    <TurnPill label={scene.turnLabel} />
                    <HudIconButtons />
                </div>
                <div
                    className={clsx(
                        'flex shrink-0 flex-nowrap items-center gap-4',
                        telemetryClassName,
                    )}
                >
                    <NumberCell label="Угол" value="47°" valueClassName="text-accent" />
                    <NumberCell label="Сила" value={64} valueClassName="text-warning" />
                    <WindCell />
                    <ResourcePips
                        label="Снаряды"
                        pips={ammoPips}
                        color="var(--color-accent)"
                        ariaLabel="снарядов"
                    />
                    <ResourcePips
                        label="Ходы"
                        pips={movePips}
                        color="var(--color-warning)"
                        ariaLabel="ходов манёвра"
                    />
                </div>
            </div>
        </div>
    );
}

function DeckOverlay({ scene, variant }: { scene: TSceneData; variant: TScreenVariant }) {
    const deckLockLabel = scene.isBotTurn ? 'Ход соперника' : null;

    if (variant === 'mobile') {
        return (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-6">
                {scene.isEmptyAmmo && <AmmoEmptyToastRow />}
                <div
                    className="pointer-events-auto flex flex-col gap-2 bg-linear-to-t from-[rgba(8,12,8,.92)] from-[26%] to-transparent px-2.5 pt-6"
                    style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 8px))' }}
                >
                    <WeaponDeckSlot ammo={scene.ammoActive} />
                    <div className="flex items-stretch gap-2">
                        <ManeuverButton direction="left" />
                        <ManeuverButton direction="right" />
                        <FireButton disabled={scene.isEmptyAmmo} hint="touch" />
                    </div>
                    <GestureHint />
                </div>
                {deckLockLabel && <DeckLockOverlay label={deckLockLabel} />}
            </div>
        );
    }

    if (variant === 'tablet') {
        return (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-6">
                {scene.isEmptyAmmo && <AmmoEmptyToastRow />}
                <div
                    className="pointer-events-auto flex items-end justify-between gap-3 px-4"
                    style={{ paddingBottom: 'calc(1.125rem + env(safe-area-inset-bottom, 8px))' }}
                >
                    <div className="w-[280px] shrink-0">
                        <WeaponDeckSlot ammo={scene.ammoActive} />
                    </div>
                    <div className="flex w-[340px] shrink-0 items-stretch gap-2">
                        <ManeuverButton direction="left" />
                        <ManeuverButton direction="right" />
                        <FireButton disabled={scene.isEmptyAmmo} hint="touch" />
                    </div>
                </div>
                {deckLockLabel && <DeckLockOverlay label={deckLockLabel} />}
            </div>
        );
    }

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-6">
            {scene.isEmptyAmmo && <AmmoEmptyToastRow />}
            <div className="pointer-events-auto flex h-[124px] flex-col items-center justify-center gap-2 border-t-[length:var(--border-w)] border-border bg-panel px-[18px] py-3">
                <div className="flex w-full max-w-[1280px] items-center justify-center gap-[18px]">
                    <div className="w-[300px] shrink-0">
                        <WeaponDeckSlot ammo={scene.ammoActive} />
                    </div>
                    <ManeuverButton direction="left" />
                    <ManeuverButton direction="right" />
                    <FireButton
                        disabled={scene.isEmptyAmmo}
                        hint="desktop"
                        className="min-w-[200px] flex-none"
                    />
                </div>
                <div className="flex items-center gap-3.5 font-ui text-[10px] text-text-dim">
                    <span>← → угол</span>
                    <span>↑ ↓ сила</span>
                    <span>Ctrl + ← → манёвр</span>
                    <span>Space выстрел</span>
                </div>
            </div>
            {deckLockLabel && <DeckLockOverlay label={deckLockLabel} />}
        </div>
    );
}

/**
 * Кадр боевого экрана `/game` на витрине (handoff «Боевой экран») — 1:1 по
 * составу с `views/game-page` + `widgets/top-hud` + `widgets/game-controls`:
 * арена `absolute inset-0`, верхний HUD и палуба — оверлеи поверх неё
 * (`z-6`), а не соседи во flex-колонке (старая раскладка). Живые виджеты не
 * импортируются напрямую: они читают `useGameStore` — единственный глобальный
 * стор не может одновременно показать несколько состояний рядом (как здесь
 * нужно). Композиция и токены — копия боевых компонентов, раскладка
 * переключается пропом `variant`, а не Tailwind `md:`/`xl:` (кадр рендерится в
 * РЕАЛЬНУЮ ширину брейкпоинта и затем ужимается `scale()` — media-запрос читал
 * бы фактический размер окна витрины, см. `frameset.ts`).
 */
export function GameScreenFrame({
    variant,
    state = 'player-turn',
}: {
    variant: TScreenVariant;
    state?: TGameScreenState;
}) {
    const scene = sceneDataFor(state);

    return (
        <ThemeScope
            faction={scene.isBotTurn ? 'enemy' : undefined}
            intensity={scene.isCalm ? 'calm' : undefined}
            className="relative block h-full w-full overflow-hidden bg-bg"
        >
            <BattleArena scene={scene} />
            <TopHudOverlay scene={scene} variant={variant} />
            <DeckOverlay scene={scene} variant={variant} />
        </ThemeScope>
    );
}
