'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
    formatAngle,
    MAX_HP,
    MOVE_BUDGET,
    useGameStore,
    WEAPONS_AMOUNT,
    WIND_DISPLAY_SCALE,
    windDirection,
    windMagnitude,
    type TPhase,
    type TSide,
} from '@/features/game-engine';
import { BOT_NAME } from '@/shared/config';
import { useAnimatedValue } from '@/shared/lib/animation';
import { useMuteState } from '@/shared/lib/audio';
import { useHoldRepeat } from '@/shared/lib/interaction';
import { themeAttrs } from '@/shared/lib/theme';
import { Button, HPBar, Icon, PipRow } from '@/shared/ui';

/** Ник профиля — плейсхолдер до auth (шаг 7, handoff «HP-карточка»). */
const PLAYER_NAME_PLACEHOLDER = 'Rex Commander';
/** Снарядов на танк — половина общего арсенала боя (см. `dealWeapons`). */
const AMMO_TOTAL = WEAPONS_AMOUNT / 2;

/** Контраст над любым скином (handoff, решение E) — единое правило для КАЖДОГО
 *  элемента HUD: подложка + blur держат читаемость над шумным/светлым рельефом
 *  арены независимо от арта. Общая строка, а не копия в каждом компоненте ниже —
 *  разойдись она, часть элементов станет нечитаемой поверх части скинов. */
const HUD_SURFACE = 'bg-[rgba(8,12,8,0.80)] backdrop-blur-[4px] shadow-[0_0_0_1px_rgba(0,0,0,.9)]';

type TTopHudProps = {
    /** Открыть паузу — сам стейт паузы и `PauseOverlay` держит `views/game-page`
     *  (widgets не может импортировать widgets, см. FSD). */
    onPauseClick?: () => void;
};

function turnPillLabel(turn: TSide, phase: TPhase): string {
    if (phase === 'flight') return 'ВЫСТРЕЛ';
    return turn === 'enemy' ? 'ХОД СОПЕРНИКА' : 'ТВОЙ ХОД';
}

/** Индикатор хода на финале скрыт (handoff «Game over»): бой окончен —
 *  индикатора хода быть не может. */
function TurnPillOrNothing({ turn, phase }: { turn: TSide; phase: TPhase }) {
    if (phase === 'over') return null;
    return <TurnPill turn={turn} phase={phase} />;
}

function HpCard({
    faction,
    label,
    value,
    active,
}: {
    faction: TSide;
    label: string;
    value: number;
    active: boolean;
}) {
    return (
        <div
            className={clsx(
                HUD_SURFACE,
                'min-w-[150px] flex-1 border-[length:var(--border-w)] p-2',
                active
                    ? faction === 'player'
                        ? 'border-accent shadow-[var(--glow-accent),0_0_0_1px_rgba(0,0,0,.9)]'
                        : 'border-enemy shadow-[var(--glow-enemy),0_0_0_1px_rgba(0,0,0,.9)]'
                    : 'border-border',
            )}
        >
            <HPBar label={label} value={value} faction={faction} max={MAX_HP} />
        </div>
    );
}

function TurnPill({ turn, phase }: { turn: TSide; phase: TPhase }) {
    return (
        <div
            className={clsx(
                HUD_SURFACE,
                // shrink-0: сосед по флекс-ряду — HP-блок с flex-1 — иначе забирает
                // всё свободное место и пилюля сжимается ниже контента (текст
                // разбивается на «ТВОЙ» / «ХОД» вместо одной строки на десктопе).
                'flex min-h-10 shrink-0 items-center gap-2 border-[length:var(--border-w)] border-[color:var(--accent)] px-3 py-2 shadow-[var(--glow)]',
            )}
        >
            <span aria-hidden className="size-2 shrink-0 bg-[color:var(--accent)]" />
            <span className="font-display text-[13px] tracking-[0.08em] whitespace-nowrap text-[color:var(--accent)] uppercase [text-shadow:var(--glow)]">
                {turnPillLabel(turn, phase)}
            </span>
        </div>
    );
}

function HudIconButtons({ onPauseClick }: { onPauseClick?: () => void }) {
    const { isMuted, toggle } = useMuteState();

    return (
        <div className="flex shrink-0 gap-2">
            <Button
                variant="ghost"
                size="icon"
                className="m-0"
                onClick={toggle}
                aria-label={isMuted ? 'Включить звук' : 'Выключить звук'}
            >
                <Icon name={isMuted ? 'mute' : 'sound'} />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                className="m-0"
                onClick={onPauseClick}
                aria-label="Пауза"
            >
                <Icon name="pause" />
            </Button>
        </div>
    );
}

/** Бордер 2px + подложка (правило E) + подпись — общая оболочка числовых
 *  ячеек телеметрии. Само значение (простое число, ± ряд или ветер) — заботa
 *  вызывающего компонента. */
function CellShell({
    label,
    className,
    children,
}: {
    label: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={clsx(
                HUD_SURFACE,
                'flex flex-col gap-0.5 border-[length:var(--border-w)] border-border px-2.5 py-1.5',
                className,
            )}
        >
            <span className="font-ui text-[9px] tracking-[0.14em] text-text-muted uppercase">
                {label}
            </span>
            {children}
        </div>
    );
}

/** 18px моб. (`compact`) / 40px десктоп (`--text-hud-xl`), tabular-nums, glow-text
 *  (handoff «Числовые ячейки»); цвет — фиксированный токен пропом, не тематический
 *  `--accent`. */
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
    compact,
}: {
    label: string;
    value: ReactNode;
    valueClassName: string;
    compact?: boolean;
}) {
    return (
        <CellShell label={label}>
            <CellValue compact={compact} valueClassName={valueClassName}>
                {value}
            </CellValue>
        </CellShell>
    );
}

/** УГОЛ/СИЛА на тач-мобилке (handoff, решение B): ± 44×44 вокруг значения —
 *  доводка после жеста рогатки, не замена ему. */
function TrimCell({
    label,
    value,
    valueClassName,
    frozen,
    onDec,
    onInc,
    decLabel,
    incLabel,
}: {
    label: string;
    value: ReactNode;
    valueClassName: string;
    frozen: boolean;
    onDec: () => void;
    onInc: () => void;
    decLabel: string;
    incLabel: string;
}) {
    // Удержание кнопки авто-повторяет шаг (#264) — тап/клавиатура дают один
    // шаг, `useHoldRepeat` сам решает, глотать ли клик после автоповтора.
    const decHold = useHoldRepeat(onDec);
    const incHold = useHoldRepeat(onInc);

    return (
        <CellShell label={label}>
            <div className="flex items-center gap-1.5">
                <Button
                    variant="ghost"
                    size="icon"
                    className="m-0"
                    disabled={frozen}
                    aria-label={decLabel}
                    {...decHold}
                >
                    −
                </Button>
                <CellValue compact valueClassName={valueClassName}>
                    {value}
                </CellValue>
                <Button
                    variant="ghost"
                    size="icon"
                    className="m-0"
                    disabled={frozen}
                    aria-label={incLabel}
                    {...incHold}
                >
                    +
                </Button>
            </div>
        </CellShell>
    );
}

function WindCell({
    wind,
    windRevealed,
    compact,
}: {
    wind: number;
    windRevealed: boolean;
    compact?: boolean;
}) {
    const direction = windDirection(wind);
    const magnitude = windMagnitude(wind);
    // Число пипов = верх шкалы силы (`WIND_DISPLAY_SCALE`), тот же, что и максимум
    // magnitude — иначе смена шкалы разведёт число пипов и потолок значения.
    const pips = Array.from({ length: WIND_DISPLAY_SCALE }, (_, index) => index < magnitude);

    return (
        <CellShell label="Ветер">
            <div className="flex items-center gap-1.5">
                <Icon
                    name={direction === 'left' ? 'arrow-l' : 'arrow-r'}
                    size={compact ? 14 : 18}
                    className="text-warning"
                />
                {windRevealed ? (
                    <CellValue compact={compact} valueClassName="text-warning">
                        {magnitude}
                    </CellValue>
                ) : (
                    <PipRow
                        pips={pips}
                        color="var(--color-warning)"
                        size={10}
                        label="грубая сила ветра"
                    />
                )}
            </div>
        </CellShell>
    );
}

function ResourcePips({
    label,
    pips,
    color,
    ariaLabel,
}: {
    label: string;
    pips: boolean[];
    color: string;
    ariaLabel: string;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="font-ui text-[9px] tracking-[0.14em] text-text-muted uppercase">
                {label}
            </span>
            <PipRow pips={pips} color={color} label={ariaLabel} />
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

/**
 * Верхний оверлей HUD (handoff «Боевой экран»): HP-карточки, пилюля хода,
 * mute/пауза, телеметрия (угол/сила/ветер/пипы). Арена — `inset:0` во весь
 * экран (родитель), этот оверлей рисуется поверх неё, `absolute top-0`, и
 * занимает ровно высоту своего контента — под ним арена остаётся кликабельной.
 *
 * Раскладка меняется по брейкпоинтам не косметикой, а составом: мобилка (390) —
 * колонка из 4 рядов с кнопками ± на угле/силе; планшет (768) — панель в 2 ряда
 * без ±; десктоп (1280/1920) — одна полоса 78px, телеметрия в одном ряду с
 * HP-барами. Три разных состава, поэтому — два блока с CSS-видимостью
 * (`md:hidden` / `hidden md:flex`), а не один узел с одним и тем же деревом.
 */
export function TopHud({ onPauseClick }: TTopHudProps = {}) {
    const playerHp = useGameStore((s) => s.hp.player);
    const enemyHp = useGameStore((s) => s.hp.enemy);
    const turn = useGameStore((s) => s.turn);
    const phase = useGameStore((s) => s.phase);
    const angle = useGameStore((s) => s.angle);
    const power = useGameStore((s) => s.power);
    const wind = useGameStore((s) => s.wind);
    const windRevealed = useGameStore((s) => s.windRevealed);
    const weapons = useGameStore((s) => s.weapons);
    const moves = useGameStore((s) => s.moves);

    const increaseAngle = useGameStore((s) => s.increaseAngle);
    const increasePower = useGameStore((s) => s.increasePower);

    const displayedPlayerHp = Math.round(useAnimatedValue(playerHp));
    const displayedEnemyHp = Math.round(useAnimatedValue(enemyHp));

    const isBotTurn = turn === 'enemy';
    // ± угла/силы лочатся и на ходе бота, и пока в полёте свой снаряд: клик на
    // выстреле иначе крутил бы ствол прямо в полёте (sync-эффект пишет угол в
    // движок) — расходится с палубой (`phase !== 'flight'`) и клавиатурой
    // (гард `!isFireMode`), где ввод на выстреле уже залочен.
    const trimFrozen = isBotTurn || phase === 'flight';
    const angleLabel = isBotTurn ? 'Угол · заморожен' : 'Угол';
    const angleValue = `${formatAngle(angle)}°`;
    const ammoPips = Array.from({ length: AMMO_TOTAL }, (_, index) => index < weapons.length);
    const movePips = Array.from({ length: MOVE_BUDGET }, (_, index) => index < moves);

    return (
        <div
            data-testid="top-hud"
            {...themeAttrs({ faction: isBotTurn ? 'enemy' : undefined })}
            className="pointer-events-none absolute inset-x-0 top-0 z-6 flex flex-col gap-2 p-2.5"
            style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top))' }}
        >
            {/* Мобилка (<768): колонка из 4 рядов, ± на угле/силе. */}
            <div
                data-testid="top-hud-mobile"
                className="pointer-events-auto flex flex-col gap-2 md:hidden"
            >
                <div className="flex gap-2">
                    <HpCard
                        faction="player"
                        label={PLAYER_NAME_PLACEHOLDER}
                        value={displayedPlayerHp}
                        active={turn === 'player'}
                    />
                    <HpCard
                        faction="enemy"
                        label={BOT_NAME}
                        value={displayedEnemyHp}
                        active={turn === 'enemy'}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <TurnPillOrNothing turn={turn} phase={phase} />
                    <div className="flex-1" />
                    <HudIconButtons onPauseClick={onPauseClick} />
                </div>
                <div className={clsx('flex gap-2', isBotTurn && 'opacity-60')}>
                    <TrimCell
                        label={angleLabel}
                        value={angleValue}
                        valueClassName="text-accent"
                        frozen={trimFrozen}
                        onDec={() => increaseAngle(Math.PI / 180)}
                        onInc={() => increaseAngle(-Math.PI / 180)}
                        decLabel="Угол меньше"
                        incLabel="Угол больше"
                    />
                    <TrimCell
                        label="Сила"
                        value={power}
                        valueClassName="text-warning"
                        frozen={trimFrozen}
                        onDec={() => increasePower(-1)}
                        onInc={() => increasePower(1)}
                        decLabel="Сила меньше"
                        incLabel="Сила больше"
                    />
                </div>
                <div
                    className={clsx(
                        'flex items-end justify-between gap-2',
                        isBotTurn && 'opacity-60',
                    )}
                >
                    <WindCell wind={wind} windRevealed={windRevealed} compact />
                    <div className="flex gap-3">
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
                {isBotTurn && <FrozenNote />}
            </div>

            {/* Планшет/десктоп (≥768): панель, без ±. 768 — 2 ряда (flex-col),
                1280/1920 — 1 ряд (xl:flex-row), центр по max-width на 1920. */}
            <div
                data-testid="top-hud-desktop"
                className="pointer-events-auto hidden md:flex md:w-full md:flex-col md:gap-3 md:border-b-[length:var(--border-w)] md:border-border md:bg-panel md:px-4 md:py-3 xl:mx-auto xl:h-[78px] xl:max-w-[1280px] xl:flex-row xl:items-center xl:gap-5 xl:py-0"
            >
                <div className="flex flex-1 flex-wrap items-center gap-4 xl:flex-nowrap">
                    {/* min-width 420 держит HP-бары на планшете (2 ряда, есть запас
                        по высоте); на 1280/1920 та же полоса — один ряд высотой 78px
                        фиксированно, и 420 там не помещается рядом с пилюлей, кнопками
                        и телеметрией (в один ряд не влезает — та же причина, по которой
                        спека прямым текстом требует 2 ряда на 768). `xl:min-w-0` снимает
                        пол — карточки внутри сами держат минимум 150px каждая. */}
                    <div className="flex min-w-[420px] flex-1 gap-2 xl:min-w-0">
                        <HpCard
                            faction="player"
                            label={PLAYER_NAME_PLACEHOLDER}
                            value={displayedPlayerHp}
                            active={turn === 'player'}
                        />
                        <HpCard
                            faction="enemy"
                            label={BOT_NAME}
                            value={displayedEnemyHp}
                            active={turn === 'enemy'}
                        />
                    </div>
                    <TurnPillOrNothing turn={turn} phase={phase} />
                    <HudIconButtons onPauseClick={onPauseClick} />
                </div>
                <div
                    className={clsx(
                        // xl:shrink-0 + xl:flex-nowrap: телеметрия — мои числа, ей
                        // нельзя тихо перенестись на вторую строку и вылезти из
                        // фиксированной высоты полосы 78px (её сжимал бы flex-1
                        // соседнего HP-блока, тот же класс бага, что и с пилюлей
                        // хода выше) — она либо помещается в ряд целиком, либо
                        // e2e-проверка переполнения должна это поймать.
                        'flex w-full flex-wrap items-center gap-4 xl:w-auto xl:shrink-0 xl:flex-nowrap',
                        isBotTurn && 'opacity-60',
                    )}
                >
                    <NumberCell
                        label={angleLabel}
                        value={angleValue}
                        valueClassName="text-accent"
                    />
                    <NumberCell label="Сила" value={power} valueClassName="text-warning" />
                    <WindCell wind={wind} windRevealed={windRevealed} />
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
                    {isBotTurn && <FrozenNote className="w-full" />}
                </div>
            </div>
        </div>
    );
}
