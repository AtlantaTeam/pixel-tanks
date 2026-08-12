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
import { BOT_NAME, POWER_MAX } from '@/shared/config';
import { useAnimatedValue } from '@/shared/lib/animation';
import { useMuteState } from '@/shared/lib/audio';
import { useHoldRepeat } from '@/shared/lib/interaction';
import { themeAttrs } from '@/shared/lib/theme';
import { Button, HPBar, Icon, PipRow, type THPBarLayout } from '@/shared/ui';

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
 *  индикатора хода быть не может. Скрываем ВИДИМОСТЬЮ, а не размонтированием
 *  (#447): узел остаётся в потоке и держит высоту ряда, поэтому геометрия HUD
 *  не «скачет» между финалом и остальными фазами. `aria-hidden` убирает пустую
 *  пилюлю из дерева скринридера — на «game over» хода нет. */
function TurnPillOrNothing({ turn, phase }: { turn: TSide; phase: TPhase }) {
    return <TurnPill turn={turn} phase={phase} hidden={phase === 'over'} />;
}

function HpCard({
    faction,
    label,
    value,
    active,
    layout = 'stacked',
}: {
    faction: TSide;
    label: string;
    value: number;
    active: boolean;
    /** `inline` — компактная карточка мобильного HUD (#450): имя/полоса/число в
     *  одну строку и меньший паддинг. Планшет/десктоп остаются `stacked`. */
    layout?: THPBarLayout;
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

/** Самая широкая из трёх подписей пилюли — резервирует её ширину (#449), см. ниже. */
const TURN_PILL_SIZER = 'ХОД СОПЕРНИКА';

function TurnPill({ turn, phase, hidden }: { turn: TSide; phase: TPhase; hidden?: boolean }) {
    const label = turnPillLabel(turn, phase);

    return (
        <div
            aria-hidden={hidden || undefined}
            className={clsx(
                HUD_SURFACE,
                // shrink-0: сосед по флекс-ряду — HP-блок с flex-1 — иначе забирает
                // всё свободное место и пилюля сжимается ниже контента (текст
                // разбивается на «ТВОЙ» / «ХОД» вместо одной строки на десктопе).
                'flex min-h-10 shrink-0 items-center gap-2 border-[length:var(--border-w)] border-[color:var(--accent)] px-3 py-2 shadow-[var(--glow)]',
                // Финал: `invisible` (visibility:hidden) прячет пилюлю, но сохраняет
                // её бокс — ряд не теряет высоту (#447).
                hidden && 'invisible',
            )}
        >
            <span aria-hidden className="size-2 shrink-0 bg-[color:var(--accent)]" />
            {/*
                Ширина текста пилюли зафиксирована под самую длинную подпись (#449):
                на планшете (768) первый ряд HUD (HP-блок + пилюля + иконки) — `flex-wrap`
                без резерва под телеметрию, и без фикс-ширины сумма HP+пилюля+иконки
                качается вокруг порога переноса. «ТВОЙ ХОД» (8 симв.) укладывается в
                строку, «ХОД СОПЕРНИКА» (13 симв., ход бота) и «ВЫСТРЕЛ» — по разному
                близко к порогу: иконки то остаются в первой строке, то переносятся во
                вторую, и высота HUD «скачет» между фазами на ровно эту разницу (68px,
                воспроизведено на 768). Тот же приём, что и `FixedNumeric` для числовых
                ячеек: невидимый размерник с самой широкой подписью держит бокс
                неизменным независимо от текущего текста. */}
            <span className="grid justify-items-start">
                <span
                    aria-hidden
                    className="invisible col-start-1 row-start-1 font-display text-[13px] tracking-[0.08em] whitespace-nowrap uppercase"
                >
                    {TURN_PILL_SIZER}
                </span>
                <span className="col-start-1 row-start-1 font-display text-[13px] tracking-[0.08em] whitespace-nowrap text-[color:var(--accent)] uppercase [text-shadow:var(--glow)]">
                    {label}
                </span>
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
    compact,
    className,
    children,
}: {
    label: string;
    /** Плотный паддинг мобильного HUD (#450) — уже, чем на планшете/десктопе. */
    compact?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={clsx(
                HUD_SURFACE,
                'flex flex-col gap-0.5 border-[length:var(--border-w)] border-border',
                compact ? 'shrink-0 px-1 py-0.5' : 'px-2.5 py-1.5',
                className,
            )}
        >
            {/* whitespace-nowrap: подпись «Угол · заморожен» на ходе бота длиннее
                «Угол» — без запрета переноса она уходит на вторую строку и растит
                высоту ячейки (а с ней и всего HUD) относительно своего хода (#447). */}
            <span className="font-ui text-[9px] tracking-[0.14em] whitespace-nowrap text-text-muted uppercase">
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
    ariaHidden,
    children,
}: {
    compact?: boolean;
    valueClassName: string;
    ariaHidden?: boolean;
    children: ReactNode;
}) {
    return (
        <span
            aria-hidden={ariaHidden}
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

/**
 * Числовое значение фиксированной ширины (#447). Ячейку телеметрии на мобилке
 * обрамляют тач-кнопки ±; если ширина значения зависит от числа знаков (`1°` →
 * `360°`), кнопки ездят и палец промахивается. Кладём поверх значения невидимый
 * «размерник» с максимальным значением диапазона в той же грид-ячейке: бокс всегда
 * шириной под максимум, реальное значение рисуется поверх, кнопки стоят неподвижно.
 * `tabular-nums` (в `CellValue`) держит равную ширину цифр, `justify-items-center`
 * центрирует значение в зарезервированном боксе.
 */
function FixedNumeric({
    compact,
    valueClassName,
    sizer,
    children,
}: {
    compact?: boolean;
    valueClassName: string;
    /** Самое широкое значение диапазона — задаёт неизменную ширину бокса. */
    sizer: ReactNode;
    children: ReactNode;
}) {
    return (
        <span className="grid justify-items-center">
            <CellValue
                compact={compact}
                ariaHidden
                valueClassName={clsx(valueClassName, 'invisible col-start-1 row-start-1')}
            >
                {sizer}
            </CellValue>
            <CellValue
                compact={compact}
                valueClassName={clsx(valueClassName, 'col-start-1 row-start-1')}
            >
                {children}
            </CellValue>
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

/**
 * Компактная тач-кнопка ± телеметрии (#450). Визуально 32×32 (плотный HUD ≤180px),
 * но **зона нажатия ≥44×44** — псевдоэлемент `before` растягивает hit-area за
 * визуальный бокс, НЕ увеличивая раскладку (он `absolute`, из потока выведен).
 * Клик по площади псевдоэлемента диспатчится самой кнопке — стандартный приём
 * расширения тач-цели без раздувания вёрстки. `before:-inset-2.5` расширяет бокс на
 * 10px во все стороны → 52×52 hit-area (запас над 44); соседние ± разведены
 * значением так, что зазор между hit-областями ≥8px (замер — e2e
 * `overlay-budget`, реальный бокс псевдоэлемента).
 */
function TrimButton({
    disabled,
    ariaLabel,
    holdProps,
    children,
}: {
    disabled: boolean;
    ariaLabel: string;
    holdProps: ReturnType<typeof useHoldRepeat>;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
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
                // Зона нажатия ≥44×44 (#450): невидимый слой `before`, расширяющий
                // бокс кнопки на 10px во все стороны (`-inset-2.5`) → 52×52 тач-цель
                // шире визуального бокса, раскладку не растит (absolute вне потока).
                "before:absolute before:-inset-2.5 before:content-['']",
            )}
            {...holdProps}
        >
            {children}
        </button>
    );
}

/** УГОЛ/СИЛА на тач-мобилке (handoff, решение B): ± вокруг значения — доводка
 *  после жеста рогатки, не замена ему. Компактная плотность (#450): кнопки
 *  визуально 34px (тач-цель ≥44 у `TrimButton`), чтобы вся телеметрия влезла
 *  в один ряд бюджетом ≤180px. */
function TrimCell({
    label,
    value,
    sizer,
    valueClassName,
    frozen,
    onDec,
    onInc,
    decLabel,
    incLabel,
    className,
}: {
    label: string;
    value: ReactNode;
    /** Максимум диапазона значения — резервирует ширину бокса (#447). */
    sizer: ReactNode;
    valueClassName: string;
    frozen: boolean;
    onDec: () => void;
    onInc: () => void;
    decLabel: string;
    incLabel: string;
    /** Доп. отступ от соседней ячейки (#452) — см. использование у «Сила». */
    className?: string;
}) {
    // Удержание кнопки авто-повторяет шаг (#264) — тап/клавиатура дают один
    // шаг, `useHoldRepeat` сам решает, глотать ли клик после автоповтора.
    const decHold = useHoldRepeat(onDec);
    const incHold = useHoldRepeat(onInc);

    return (
        <CellShell label={label} compact className={className}>
            <div className="flex items-center gap-0.5">
                <TrimButton disabled={frozen} ariaLabel={decLabel} holdProps={decHold}>
                    −
                </TrimButton>
                <FixedNumeric compact valueClassName={valueClassName} sizer={sizer}>
                    {value}
                </FixedNumeric>
                <TrimButton disabled={frozen} ariaLabel={incLabel} holdProps={incHold}>
                    +
                </TrimButton>
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

    const content = windRevealed ? (
        // На мобилке (`compact`) число ветра прижато к `leading-none` — ровно та же
        // высота строки, что у невидимого размерника-высоты бокса ниже; иначе
        // раскрытое число (обычный line-height ~27px) выше пипов (18px) и растит
        // ячейку. Планшет/десктоп (`!compact`) не трогаем.
        <CellValue
            compact={compact}
            valueClassName={clsx('text-warning', compact && 'leading-none')}
        >
            {magnitude}
        </CellValue>
    ) : (
        <PipRow
            pips={pips}
            color="var(--color-warning)"
            size={compact ? 8 : 10}
            gap={compact ? 3 : 5}
            label="грубая сила ветра"
        />
    );

    return (
        <CellShell label="Ветер" compact={compact}>
            <div className={clsx('flex items-center', compact ? 'gap-1' : 'gap-1.5')}>
                <Icon
                    name={direction === 'left' ? 'arrow-l' : 'arrow-r'}
                    size={compact ? 14 : 18}
                    className="text-warning"
                />
                {/* Мобилка (#447): бокс значения фиксирован, чтобы ячейка «Ветер» не
                    менялась при переходе «ряд пипов» ↔ «раскрытое число». Два невидимых
                    размерника в той же грид-ячейке задают неизменный бокс: `w-8` (32px =
                    3 пипа 8px + 2 зазора 3px + запас) — ширину под ряд пипов, символ высотой
                    `text-[18px]` — высоту под раскрытое число (оно выше пипов). Реальный
                    контент рисуется поверх. Планшет/десктоп (`!compact`) не трогаем —
                    там ячейка стоит в ряду с числовыми ячейками той же высоты, скачка
                    геометрии нет. */}
                {compact ? (
                    <span className="grid justify-items-center">
                        <span aria-hidden className="col-start-1 row-start-1 h-0 w-8" />
                        <span
                            aria-hidden
                            className="invisible col-start-1 row-start-1 font-ui text-[18px] leading-none font-bold"
                        >
                            0
                        </span>
                        <span className="col-start-1 row-start-1 flex items-center">{content}</span>
                    </span>
                ) : (
                    content
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
    size,
    gap,
}: {
    label: string;
    pips: boolean[];
    color: string;
    ariaLabel: string;
    /** Размер пипа — компактный HUD (#450) уменьшает до 8px, чтобы снаряды и ходы
     *  встали в общий ряд телеметрии. Дефолт — канон 14px (планшет/десктоп). */
    size?: number;
    /** Зазор между пипами — компактный HUD ужимает до 2px (см. `PipRow.gap`). */
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
            {/* Мобилка (<768): три ряда — HP-карточки (inline), пилюля хода +
                иконки, единый ряд телеметрии. Компактная плотность (#450). */}
            <div
                data-testid="top-hud-mobile"
                className="pointer-events-auto flex flex-col gap-1.5 md:hidden"
            >
                <div className="flex gap-2">
                    <HpCard
                        faction="player"
                        label={PLAYER_NAME_PLACEHOLDER}
                        value={displayedPlayerHp}
                        active={turn === 'player'}
                        layout="inline"
                    />
                    <HpCard
                        faction="enemy"
                        label={BOT_NAME}
                        value={displayedEnemyHp}
                        active={turn === 'enemy'}
                        layout="inline"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <TurnPillOrNothing turn={turn} phase={phase} />
                    <div className="flex-1" />
                    <HudIconButtons onPauseClick={onPauseClick} />
                </div>
                {/* Вся телеметрия — один ряд (#450): угол / сила / ветер / пипы.
                    Прежние два ряда съедали высоту; компактная плотность (ячейки
                    `compact`, кнопки ± визуально 34px, пипы 8px) укладывает их в
                    одну строку, удерживая бюджет HUD ≤180px.
                    `relative`: заметка о заморозке (#447) выводится из потока —
                    absolute-оверлеем поверх ряда, а не добавляя высоту. */}
                <div
                    className={clsx(
                        'relative flex items-stretch gap-1.5',
                        isBotTurn && 'opacity-60',
                    )}
                >
                    <TrimCell
                        label={angleLabel}
                        value={angleValue}
                        sizer="360°"
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
                        sizer={POWER_MAX}
                        valueClassName="text-warning"
                        frozen={trimFrozen}
                        onDec={() => increasePower(-1)}
                        onInc={() => increasePower(1)}
                        decLabel="Сила меньше"
                        incLabel="Сила больше"
                        // Доп. отступ слева (#452): тач-цель кнопок ± шире визуального
                        // бокса (`TrimButton`, псевдоэлемент 52×52) — без этого зазор
                        // между «Угол больше» и «Сила меньше» падал до 2px хит-зон
                        // вплотную к соседней ячейке (бюджет ≥8px, замер `overlay-budget`).
                        className="ml-2"
                    />
                    <WindCell wind={wind} windRevealed={windRevealed} compact />
                    {/* Снаряды и ходы — компактной колонкой (пипы 8px): два ряда
                        держат подписи, но по ширине встают рядом с ячейками. */}
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
                    {isBotTurn && (
                        <FrozenNote className="pointer-events-none absolute inset-x-0 bottom-0" />
                    )}
                </div>
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
                        // `relative`: заметка о заморозке — absolute-оверлей (#447),
                        // не перенос строки, иначе её появление растит высоту панели
                        // на планшете (768).
                        'relative flex w-full flex-wrap items-center gap-4 xl:w-auto xl:shrink-0 xl:flex-nowrap',
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
                    {isBotTurn && (
                        <FrozenNote className="pointer-events-none absolute inset-x-0 bottom-0" />
                    )}
                </div>
            </div>
        </div>
    );
}
