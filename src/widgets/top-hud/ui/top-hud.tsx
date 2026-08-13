'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
    formatAngle,
    MAX_HP,
    MOVE_BUDGET,
    useArenaInset,
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
function TurnPillOrNothing({
    turn,
    phase,
    stretch,
}: {
    turn: TSide;
    phase: TPhase;
    stretch?: boolean;
}) {
    return <TurnPill turn={turn} phase={phase} hidden={phase === 'over'} stretch={stretch} />;
}

function HpCard({
    faction,
    label,
    value,
    active,
    layout = 'stacked',
    hitNonce,
}: {
    faction: TSide;
    label: string;
    value: number;
    active: boolean;
    /** `inline` — компактная карточка мобильного HUD (#450): имя/полоса/число в
     *  одну строку и меньший паддинг. Планшет/десктоп остаются `stacked`.
     *  На 320px (#537) min-width 130px вместо 150px даёт место для обеих карточек
     *  и зазора между ними. */
    layout?: THPBarLayout;
    /** Счётчик попаданий по ЭТОЙ стороне (issue #549, §7.2 разбора #534) —
     *  прокидывается в `HPBar`, триггерит сдвиг трека + белую засветку
     *  заливки (см. докблок `HpTrack`). */
    hitNonce?: number;
}) {
    return (
        <div
            className={clsx(
                HUD_SURFACE,
                'min-w-[130px] flex-1 border-[length:var(--border-w)]',
                // На 768–1279 (#538) паддинг карточки ужат до p-1.5 — бюджет высоты
                // ряда 1 (44px, вместе с пилюлей/бейджем/иконками) не оставляет места
                // под исходный p-2. С xl (1280, полоса 78px фиксирована, есть запас)
                // паддинг возвращается к каноничному p-2.
                // py-1 (не py-1.5=6px, вне легального шага #541): карточка HP —
                // прямой ребёнок ряда 1 (мобилка h-8=32, планшет md:h-11=44) и
                // получает высоту ряда через stretch, а не через собственный
                // паддинг — паддинг только держит контент от клипа на самом
                // тесном (32px) бюджете.
                layout === 'inline' ? 'px-1.5 py-1' : 'p-1.5 xl:p-2',
                // Без glow (#548, разбор §2): HP — класс 2 «раз в ход», карточка
                // держит активную сторону только цветом рамки. Glow остаётся
                // только у угла/силы (класс 1) — иначе на кадре прицеливания
                // светится и HP, и пилюля хода, и телеметрия одновременно.
                active
                    ? faction === 'player'
                        ? 'border-accent'
                        : 'border-enemy'
                    : 'border-border',
            )}
        >
            <HPBar
                label={label}
                value={value}
                faction={faction}
                max={MAX_HP}
                layout={layout}
                hitNonce={hitNonce}
            />
        </div>
    );
}

/** Самая широкая из трёх подписей пилюли — резервирует её ширину (#449), см. ниже. */
const TURN_PILL_SIZER = 'ХОД СОПЕРНИКА';

function TurnPill({
    turn,
    phase,
    hidden,
    stretch,
}: {
    turn: TSide;
    phase: TPhase;
    hidden?: boolean;
    /** Тянуть плашку до соседа (мобильный ряд, #528) — вместо распорки `flex-1`. */
    stretch?: boolean;
}) {
    const label = turnPillLabel(turn, phase);

    return (
        <div
            data-testid="turn-pill"
            aria-hidden={hidden || undefined}
            className={clsx(
                HUD_SURFACE,
                // shrink-0: сосед по флекс-ряду — HP-блок с flex-1 — иначе забирает
                // всё свободное место и пилюля сжимается ниже контента (текст
                // разбивается на «ТВОЙ» / «ХОД» вместо одной строки на десктопе).
                // На 320px (#537): `min-w-0` вместо `shrink-0` — позволяет пилюле
                // сжиматься ниже min-content, если места критически мало.
                // px-2 xl:px-3 (#538): на 768–1279 правая группа ряда 1 (пилюля +
                // бейдж + иконки) конкурирует с HP-картами за ширину строки — HP по
                // спеке обязан схлопываться последним (handoff «HP-карточка»), значит
                // резерв под самую длинную подпись пилюли (#449) надо ужать первым.
                // Без shadow-glow (#548): пилюля хода — класс 3 «состояние»,
                // остаётся цветной плашкой (рамка + текст в --accent), не
                // источником свечения — glow держат только угол и сила.
                'flex min-h-10 min-w-0 items-center gap-1.5 border-[length:var(--border-w)] border-[color:var(--accent)] px-2 py-2 xl:gap-2 xl:px-3',
                // На десктопе сосед по ряду — HP-блок с flex-1: без shrink-0 он забирает
                // всё свободное место, и пилюля сжимается ниже контента («ТВОЙ» / «ХОД»
                // в две строки). В мобильном ряду соседи — только кнопки фиксированной
                // ширины, там плашка, наоборот, тянется сама (#528).
                stretch ? 'flex-1' : 'shrink',
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
                {/* text-[11px] tracking-[0.02em] xl:text-[13px] xl:tracking-[0.08em]
                    (#538): тот же бюджет ширины ряда 1 — резерв под «ХОД СОПЕРНИКА»
                    при каноничном 13px/0.08em (~150px) оставлял HP-картам всего
                    ~250px на двоих (упирались в собственный `min-w-[130px]` каждая,
                    имя схлопывалось до 0 — HP обязан схлопываться последним, не
                    наоборот). С xl (полоса 78px, есть запас) — канон кода. */}
                <span
                    aria-hidden
                    className="invisible col-start-1 row-start-1 font-display text-[11px] tracking-[0.02em] whitespace-nowrap uppercase xl:text-[13px] xl:tracking-[0.08em]"
                >
                    {TURN_PILL_SIZER}
                </span>
                <span className="col-start-1 row-start-1 font-display text-[11px] tracking-[0.02em] whitespace-nowrap text-[color:var(--accent)] uppercase xl:text-[13px] xl:tracking-[0.08em]">
                    {label}
                </span>
            </span>
        </div>
    );
}

function HudIconButtons({ onPauseClick }: { onPauseClick?: () => void }) {
    const { isMuted, toggle } = useMuteState();

    return (
        // items-center (#541): обёртка — прямой ребёнок кластера статуса,
        // который на планшете/десктопе растянут (stretch) до высоты ряда
        // (44/56px), а сами кнопки — фиксированные 44×44 (`size-11`,
        // `Button` size="icon") и не тянутся вместе с обёрткой; центрируем
        // их внутри, а не прижимаем к верхнему краю.
        <div className="flex shrink-0 items-center gap-2">
            <Button
                variant="ghost"
                size="icon"
                // `!m-0` (important), не просто `m-0` (#538): базовый `Button`
                // задаёт `m-1` для ВСЕХ кнопок (`button.tsx`), а генерируемый Tailwind
                // 4 CSS упорядочивает утилиты `m-*` по числовой шкале, а не по
                // порядку классов в JSX — `m-1` (правило дальше по шкале) в итоговом
                // файле стоит ПОСЛЕ `m-0` и выигрывает каскад независимо от того, что
                // `m-0` написан в className позже. Без `!` кнопки mute/пауза
                // получали паразитные 4px margin со всех сторон (44+8=52px вместо
                // 44), и ряд 1 HUD не укладывался в бюджет высоты 44px.
                className="!m-0"
                onClick={toggle}
                aria-label={isMuted ? 'Включить звук' : 'Выключить звук'}
            >
                <Icon name={isMuted ? 'mute' : 'sound'} />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                // `!m-0` (important), не просто `m-0` (#538): базовый `Button`
                // задаёт `m-1` для ВСЕХ кнопок (`button.tsx`), а генерируемый Tailwind
                // 4 CSS упорядочивает утилиты `m-*` по числовой шкале, а не по
                // порядку классов в JSX — `m-1` (правило дальше по шкале) в итоговом
                // файле стоит ПОСЛЕ `m-0` и выигрывает каскад независимо от того, что
                // `m-0` написан в className позже. Без `!` кнопки mute/пауза
                // получали паразитные 4px margin со всех сторон (44+8=52px вместо
                // 44), и ряд 1 HUD не укладывался в бюджет высоты 44px.
                className="!m-0"
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
    tight,
    className,
    children,
}: {
    label: string;
    /** Плотный паддинг мобильного HUD (#450) — уже, чем на планшете/десктопе. */
    compact?: boolean;
    /** Без паддинга — только рамка + подложка (#528, десктопная пара «Снаряды»/
     *  «Ходы»): на узком xl (1280) телеметрия — один нешринкающийся ряд
     *  (`xl:shrink-0 xl:flex-nowrap`), и обычный паддинг двух новых карточек не
     *  влезает в оставшийся бюджет ширины полосы (замер — 410px доступно против
     *  431px с обычным `CellShell`). Планшет/1920 паддинг не жмёт, но тот же
     *  компонент не должен «прыгать» составом между брейкпоинтами. */
    tight?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={clsx(
                HUD_SURFACE,
                // justify-center (#541): высота ячейки теперь задаётся РЯДОМ
                // (`items-stretch` на родителе, легальная высота 32/44/56), не
                // суммой паддинга+контента — ячейка растягивается до высоты
                // ряда, а метка+значение центрируются внутри неё, а не
                // прилипают к верхнему краю.
                'flex flex-col justify-center border-[length:var(--border-w)] border-border',
                // gap-1 (4px, легальный «внутри ячейки» #541) на компактных
                // мобильных ячейках; 0 — на планшете/десктопе (label+value уже
                // укладываются в 44/56 без зазора, добавлять нечего). Прежние
                // 0.5 (2px) и xl:0.5 (2px) — вне легального набора {4,8,16}.
                compact ? 'gap-1' : 'gap-0',
                // px-2 py-1 xl:px-1 xl:py-0 (#541, легальный набор {4,8,16} —
                // прежние px-2.5=10px/xl:px-1.5=6px/py-0.5=2px вне набора).
                // Вертикальный паддинг больше не держит высоту ячейки (её
                // держит `items-stretch` ряда) — только не даёт контенту
                // клипаться на самом тесном легальном бюджете (56px на xl при
                // значении 40px + подписи 9px + рамке 4px).
                // На 320px (#537) ячейки сжимаются: без `shrink-0` и с минимальным паддингом
                // (px-0 py-0 экономит до 4px на каждой ячейке × 4 ячейки = 16px в ряду).
                // Мобилка без shrink-0: на узком вьюпорте ячейки гибче к переносу,
                // чем плотная раскладка которая не влезает совсем.
                tight ? '' : compact ? 'px-0 py-0' : 'px-2 py-1 xl:px-1 xl:py-0',
                className,
            )}
        >
            {/* whitespace-nowrap: подпись «Угол · заморожен» на ходе бота длиннее
                «Угол» — без запрета переноса она уходит на вторую строку и растит
                высоту ячейки (а с ней и всего HUD) относительно своего хода (#447).
                На 320px (#537): метка скрыта при compact=true (sr-only), остаётся в
                дереве доступности. */}
            <span
                className={clsx(
                    'font-ui text-[9px] tracking-[0.14em] whitespace-nowrap text-text-muted uppercase',
                    // leading-none (#538, только !compact): без сброса унаследованный
                    // line-height (~1.5×) добавлял 4.5px на каждой ячейке ряда 2
                    // планшета — полоса не укладывалась в бюджет высоты. Мобилка
                    // (compact) не тронута: метка скрыта (`w-0 overflow-hidden`), но
                    // её line-height участвует в высоте существующих mobile e2e-барьеров
                    // (`overlay-budget.spec.ts`, `hud-geometry-stable.spec.ts`).
                    !compact && 'leading-none',
                    compact && 'w-0 overflow-hidden',
                )}
            >
                {label}
            </span>
            {children}
        </div>
    );
}

/** 18px моб. (`compact`) / 22px планшет / 40px десктоп xl (`--text-hud-xl`),
 *  tabular-nums; цвет — фиксированный токен пропом, не тематический `--accent`.
 *  На 768–1279 (#538) значение — 22px, не 40: `--text-hud-xl` держит ряд
 *  телеметрии высотой ~71px — вместе с рядом 1 и зазорами это раздувало полосу
 *  HUD выше объявленного зоне жеста инсета 128px. С xl (1280, полоса 78px c
 *  запасом) возвращается канон кода — `--text-hud-xl`.
 *  `glow` (#548, разбор §2) — text-shadow только для класса 1 «непрерывно»
 *  (угол, сила): раньше glow-text висел на КАЖДОЙ числовой ячейке (включая
 *  раскрытое число ветра), и на кадре прицеливания светилось всё сразу —
 *  «светится почти всё, значит не светится ничто». Дефолт `false` — опт-ин,
 *  не опт-аут, чтобы новый вызывающий не получил glow молча. */
function CellValue({
    compact,
    valueClassName,
    ariaHidden,
    glow,
    children,
}: {
    compact?: boolean;
    valueClassName: string;
    ariaHidden?: boolean;
    glow?: boolean;
    children: ReactNode;
}) {
    return (
        <span
            aria-hidden={ariaHidden}
            className={clsx(
                'font-ui font-bold tabular-nums',
                glow && '[text-shadow:var(--glow-text)]',
                // leading-none (#538, только !compact): `text-[22px]` — произвольное
                // значение без своего `--text-*--line-height` (в отличие от
                // `--text-hud-xl`, у него `line-height:1` уже в токене) — без сброса
                // браузер считает высоту строки от унаследованного line-height
                // (~1.5×), и 22px-цифра занимала 33px вместо 22 — ряд 2 планшета не
                // укладывался в бюджет высоты полосы. Мобилка (`compact`, 18px) не
                // тронута — держит исходный line-height, на который уже настроены
                // существующие mobile e2e-барьеры высоты (`overlay-budget.spec.ts`,
                // `hud-geometry-stable.spec.ts`).
                !compact && 'leading-none',
                compact ? 'text-[18px]' : 'text-[22px] xl:text-hud-xl',
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
    glow,
    children,
}: {
    compact?: boolean;
    valueClassName: string;
    /** Самое широкое значение диапазона — задаёт неизменную ширину бокса. */
    sizer: ReactNode;
    /** См. `CellValue.glow` (#548) — угол/сила прокидывают `true`. */
    glow?: boolean;
    children: ReactNode;
}) {
    return (
        <span className="grid justify-items-center">
            <CellValue
                compact={compact}
                ariaHidden
                glow={glow}
                valueClassName={clsx(valueClassName, 'invisible col-start-1 row-start-1')}
            >
                {sizer}
            </CellValue>
            <CellValue
                compact={compact}
                glow={glow}
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
    sizer,
    glow,
}: {
    label: string;
    value: ReactNode;
    valueClassName: string;
    /** Максимум диапазона значения (#473) — резервирует ширину бокса тем же
     *  приёмом `FixedNumeric`, что и мобильная `TrimCell`: планшет/десктоп больше
     *  не «ездят» при смене числа знаков (угол `1°`…`345°`, сила `1`…`20`). Без
     *  `sizer` ячейка тянется по содержимому (обратная совместимость). */
    sizer?: ReactNode;
    /** См. `CellValue.glow` (#548) — только угол/сила (класс 1). */
    glow?: boolean;
}) {
    return (
        <CellShell label={label}>
            {sizer !== undefined ? (
                <FixedNumeric valueClassName={valueClassName} sizer={sizer} glow={glow}>
                    {value}
                </FixedNumeric>
            ) : (
                <CellValue valueClassName={valueClassName} glow={glow}>
                    {value}
                </CellValue>
            )}
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
    className,
}: {
    disabled: boolean;
    ariaLabel: string;
    holdProps: ReturnType<typeof useHoldRepeat>;
    children: ReactNode;
    className?: string;
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
                className,
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
    glow,
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
    /** См. `CellValue.glow` (#548) — только угол/сила (класс 1). */
    glow?: boolean;
}) {
    // Удержание кнопки авто-повторяет шаг (#264) — тап/клавиатура дают один
    // шаг, `useHoldRepeat` сам решает, глотать ли клик после автоповтора.
    const decHold = useHoldRepeat(onDec);
    const incHold = useHoldRepeat(onInc);

    return (
        <CellShell label={label} compact className={className}>
            <div className="flex min-w-0 items-center gap-0.5">
                {/* На 320px (#537) ± кнопки скрыты визуально (sr-only), остаются
                    для a11y. Экономит ~70px в ряду (две ячейки, по 4 кнопки ~32px+32px). */}
                <TrimButton
                    disabled={frozen}
                    ariaLabel={decLabel}
                    holdProps={decHold}
                    className="sr-only"
                >
                    −
                </TrimButton>
                <FixedNumeric compact valueClassName={valueClassName} sizer={sizer} glow={glow}>
                    {value}
                </FixedNumeric>
                <TrimButton
                    disabled={frozen}
                    ariaLabel={incLabel}
                    holdProps={incHold}
                    className="sr-only"
                >
                    +
                </TrimButton>
            </div>
        </CellShell>
    );
}

/** Размер и зазор пипов ветра по плотности HUD — ЕДИНЫЙ источник для видимого ряда
 *  пипов и невидимого размерника ширины (#473). Держи их порознь — поменяют размер
 *  видимых пипов на десктопе, а хардкод размерника промолчит: бокс перестанет
 *  держать ту же ширину, и ячейка «Ветер» снова «поедет» при раскрытии числа (ровно
 *  баг, который размерник и чинит). */
const WIND_PIP_DESKTOP = { size: 10, gap: 5 } as const;
const WIND_PIP_COMPACT = { size: 8, gap: 3 } as const;

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
    const pipDims = compact ? WIND_PIP_COMPACT : WIND_PIP_DESKTOP;
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
            size={pipDims.size}
            gap={pipDims.gap}
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
                    // Планшет/десктоп (#473): та же болезнь, что чинил #447 на мобилке —
                    // ячейка «Ветер» уже пипов при раскрытом числе (пипы шире одиночной
                    // цифры), поэтому при переходе «ряд пипов → раскрытое число» она
                    // сужается и тянет за собой координаты соседей. Ширину держит
                    // невидимый ряд пипов той же размерности (длина фиксирована
                    // `WIND_DISPLAY_SCALE`, от magnitude не зависит) — бокс всегда под
                    // самое широкое состояние, реальный контент рисуется поверх.
                    <span className="grid justify-items-center">
                        <span aria-hidden className="invisible col-start-1 row-start-1">
                            <PipRow
                                pips={pips}
                                color="var(--color-warning)"
                                size={WIND_PIP_DESKTOP.size}
                                gap={WIND_PIP_DESKTOP.gap}
                            />
                        </span>
                        <span className="col-start-1 row-start-1 flex items-center">{content}</span>
                    </span>
                )}
            </div>
        </CellShell>
    );
}

/** Сами пипы без подписи и без обёртки-карточки (#528) — общий визуал для
 *  мобильной `ResourcePips` (своя подпись, своя плотная карточка) и десктопной
 *  `CellShell`-обёртки (подпись и карточка — её работа, дублировать не нужно). */
function ResourcePipVisual({
    pips,
    color,
    ariaLabel,
    size,
    gap,
}: {
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
        // xl-плотность (#489): на узком xl (1280…~1413) телеметрия в один
        // нешринкающийся ряд (`shrink-0`) уезжает за край — компактнее пипы
        // снарядов/ходов освобождают ей место. `size`/`gap` тут не передаются
        // (Снаряды/Ходы = default 14px/5px, планшет не трогаем), поэтому цель —
        // через arbitrary-variant по `data-testid`, а не проп: класс работает
        // только под `xl:`-медиа, планшет (768, тот же `ResourcePipVisual`) их не видит.
        <PipRow
            pips={pips}
            color={color}
            label={ariaLabel}
            size={size}
            gap={gap}
            className="xl:gap-[3px] xl:[&>[data-testid=pip]]:size-2.5"
        />
    );
}

/**
 * Снаряды/ходы мобильного ряда телеметрии (#528): своя подпись + `ResourcePipVisual`,
 * в собственной плотной карточке (см. использование ниже) — раньше висели прямо на
 * небе без подложки, читались хуже соседних ячеек на светлом/тёмном пресете.
 * `dense` сжимает внутренний зазор подпись↔пипы до 2px (было 4): бюджет ряда
 * телеметрии — высота соседней ячейки «Угол» (55.5px), и на добавленный бордер
 * карточки (4px) места хватает только при плотном зазоре — обычный `gap-1`
 * (как на планшете/десктопе, где карточка не в стеснённом ряду) row вырастил бы.
 */
function ResourcePips({
    label,
    pips,
    color,
    ariaLabel,
    size,
    gap,
    dense,
    hideLabel,
}: {
    label: string;
    pips: boolean[];
    color: string;
    ariaLabel: string;
    size?: number;
    gap?: number;
    dense?: boolean;
    /** На 320px (#537) спрячь метку для сэкономить места. */
    hideLabel?: boolean;
}) {
    return (
        <div className={clsx('flex flex-col', dense ? 'gap-0.5' : 'gap-1')}>
            <span
                className={clsx(
                    'font-ui text-[9px] tracking-[0.14em] text-text-muted uppercase',
                    hideLabel && 'w-0 overflow-hidden',
                )}
            >
                {label}
            </span>
            <ResourcePipVisual
                pips={pips}
                color={color}
                ariaLabel={ariaLabel}
                size={size}
                gap={gap}
            />
        </div>
    );
}

const FROZEN_TEXT = 'Твои числа заморожены до конца хода соперника';

function FrozenNote({ className }: { className?: string }) {
    return (
        <p
            className={clsx(
                HUD_SURFACE,
                'border-[length:var(--border-w)] border-border px-2.5 py-1.5 font-ui text-[10px] text-text-muted uppercase',
                className,
            )}
        >
            {FROZEN_TEXT}
        </p>
    );
}

/**
 * Планшет/десктоп (#472): короткий бейдж «Заморожено» рядом с пилюлей хода,
 * а не внутри ряда телеметрии. Прежняя `FrozenNote` лежала внутри телеметрии
 * `absolute`-оверлеем (#447) — годится на мобилке, где ряд ниже; на `xl`
 * (78px, `flex-nowrap`) высоты под целую строку текста внутри того же ряда
 * нет по построению, и бейдж лёг поверх числовых ячеек.
 *
 * Слот зарезервирован ВСЕГДА (тот же приём, что `TurnPillOrNothing` — #447):
 * узел остаётся в потоке, видимость — через `invisible`, а не размонтирование.
 * Появление/исчезновение бейджа не двигает ни пилюлю, ни иконки, ни телеметрию.
 *
 * Бейдж — чисто ВИЗУАЛЬНЫЙ индикатор (`aria-hidden` всегда): скринридеру о
 * заморозке сообщает отдельный постоянный live-region в корне HUD
 * (`FreezeAnnouncer`), а не переключение `role` на этом узле. Live-region обязан
 * уже существовать в дереве доступности ДО появления текста, иначе анонса нет;
 * бейдж же то `aria-hidden`, то `invisible` — на такой смене большинство
 * скринридеров молчат. Поэтому анонс вынесен из бейджа.
 */
function FreezeBadgeOrNothing({ visible }: { visible: boolean }) {
    return (
        <div
            data-testid="freeze-badge"
            aria-hidden
            className={clsx(
                HUD_SURFACE,
                // px-1.5 gap-1 xl:px-2.5 xl:gap-1.5 (#538): та же экономия ширины
                // ряда 1 на 768–1279, что и у пилюли хода — HP-карты обязаны
                // схлопываться последними.
                'flex min-h-10 shrink-0 items-center gap-1 border-[length:var(--border-w)] border-border px-1.5 py-1.5 xl:gap-1.5 xl:px-2.5',
                !visible && 'invisible',
            )}
        >
            <Icon name="lock" size={12} className="shrink-0 text-text-muted" />
            <span className="font-ui text-[9px] tracking-[0.06em] whitespace-nowrap text-text-muted uppercase xl:text-[10px] xl:tracking-[0.1em]">
                Заморожено
            </span>
        </div>
    );
}

/**
 * Единственный анонс заморозки ввода для скринридера (a11y) — общий для обоих
 * составов (мобильная `FrozenNote` и десктопный `FreezeBadgeOrNothing`
 * визуальны/`aria-hidden`). Узел смонтирован ВСЕГДА и пуст на своём ходу; на ходе
 * бота в него ВПИСЫВАЕТСЯ текст. Именно смена содержимого уже существующего
 * live-region (`aria-live=polite`) озвучивается — в отличие от появления узла
 * или переключения `role`/`visibility` на готовом заполненном узле.
 *
 * Живой регион через `aria-live` + `aria-atomic`, а НЕ через `role="status"`:
 * `status` — это ARIA-роль, и она бы конфликтовала с `getByRole('status')`
 * тоста «патроны кончились» (у него та же роль) — в бою на экране оказалось бы
 * два `status`. `aria-live` даёт то же озвучивание смены содержимого без роли.
 * `sr-only` — только для скринридера, `absolute` (вне потока), геометрию HUD не
 * трогает.
 */
function FreezeAnnouncer({ frozen }: { frozen: boolean }) {
    return (
        <span data-testid="freeze-live" aria-live="polite" aria-atomic="true" className="sr-only">
            {frozen ? FROZEN_TEXT : ''}
        </span>
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
    const lastHit = useGameStore((s) => s.lastHit);
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
    // Вспышка HP-полосы задетой стороны (#549) — только та карточка, что
    // реально задета этим попаданием, получает свежий nonce.
    const playerHitNonce = lastHit?.target === 'player' ? lastHit.nonce : undefined;
    const enemyHitNonce = lastHit?.target === 'enemy' ? lastHit.nonce : undefined;

    // Публикуем фактическую высоту HUD в верхний инсет арены (контракт safe-зоны,
    // #453): высота разная по брейкпоинтам и от safe-area — движок читает её из
    // стора, а не хардкодит (см. `useArenaInset`).
    const insetRef = useArenaInset<HTMLDivElement>('top');

    const isBotTurn = turn === 'enemy';
    // ± угла/силы лочатся и на ходе бота, и пока в полёте свой снаряд: клик на
    // выстреле иначе крутил бы ствол прямо в полёте (sync-эффект пишет угол в
    // движок) — расходится с палубой (`phase !== 'flight'`) и клавиатурой
    // (гард `!isFireMode`), где ввод на выстреле уже залочен.
    const trimFrozen = isBotTurn || phase === 'flight';
    // Бейдж "Заморожено" показываем только на ходе бота, но НЕ во время его
    // полёта (#539): на полёте плашка "ВЫСТРЕЛ" уже сообщает о состоянии,
    // дополнительный бейдж — лишнее сообщение об одном и том же.
    const showFreezeBadge = isBotTurn && phase !== 'flight';
    const angleLabel = isBotTurn ? 'Угол · заморожен' : 'Угол';
    const angleValue = `${formatAngle(angle)}°`;
    const ammoPips = Array.from({ length: AMMO_TOTAL }, (_, index) => index < weapons.length);
    const movePips = Array.from({ length: MOVE_BUDGET }, (_, index) => index < moves);

    return (
        <div
            ref={insetRef}
            data-testid="top-hud"
            {...themeAttrs({ faction: isBotTurn ? 'enemy' : undefined })}
            className="pointer-events-none absolute inset-x-0 top-0 z-6 flex flex-col gap-2 p-2.5"
            style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top))' }}
        >
            {/* Анонс заморозки — один на оба состава, смонтирован всегда (a11y, #472). */}
            <FreezeAnnouncer frozen={isBotTurn} />
            {/* Мобилка (<768): три ряда — HP-карточки (inline), пилюля хода +
                иконки, единый ряд телеметрии. Компактная плотность (#450). */}
            <div
                data-testid="top-hud-mobile"
                // gap-2 (8px, легальный «между группами» #541) — было gap-1.5
                // (6px), вне легального набора {4,8,16}.
                className="pointer-events-auto flex flex-col gap-2 md:hidden"
            >
                {/* h-8 (32px, легальная «служебная строка без тач-цели» #541):
                    HP-карточки не несут собственных тач-целей — угол/сила
                    рядом ниже уже используют 44px. items-stretch — дефолт
                    flex без явного align-items, оставлен явно для читаемости. */}
                <div className="flex h-8 items-stretch gap-2" data-testid="top-hud-mobile-hp-row">
                    <HpCard
                        faction="player"
                        label={PLAYER_NAME_PLACEHOLDER}
                        value={displayedPlayerHp}
                        active={turn === 'player'}
                        layout="inline"
                        hitNonce={playerHitNonce}
                    />
                    <HpCard
                        faction="enemy"
                        label={BOT_NAME}
                        value={displayedEnemyHp}
                        active={turn === 'enemy'}
                        layout="inline"
                        hitNonce={enemyHitNonce}
                    />
                </div>
                {/* Плашка хода тянется до кнопок сама (#528): раньше между ними стояла
                    распорка `flex-1`, и на 390 получалась дыра в 38 px при общем ритме
                    панели в 8 — единственный такой провал в раскладке.
                    На 320px (#537): плашка не тянется — бюджет узкий; `gap-1` вместо
                    `gap-2` экономит ещё 2px. */}
                {/* h-11 (44px, легальная «минимальная тач-цель» #541) — обе
                    кнопки-иконки уже 44×44, пилюля хода растягивается
                    (items-stretch) до той же высоты вместо собственных 40px. */}
                <div
                    className="flex h-11 min-w-0 items-stretch gap-1"
                    data-testid="top-hud-mobile-status-row"
                >
                    <TurnPillOrNothing turn={turn} phase={phase} stretch={false} />
                    <HudIconButtons onPauseClick={onPauseClick} />
                </div>
                {/* Вся телеметрия — один ряд (#450): угол / сила / ветер / пипы.
                    Прежние два ряда съедали высоту; компактная плотность (ячейки
                    `compact`, кнопки ± визуально 34px, пипы 8px) укладывает их в
                    одну строку, удерживая бюджет HUD ≤180px.
                    На 320px (#537): `min-w-0` разрешает flex-item сжиматься ниже
                    min-width содержимого; `gap-0.5` вместо `gap-1.5` экономит ещё 4px
                    (восемь промежутков по 2px вместо 4px). `relative`: заметка о
                    заморозке (#447) выводится из потока — absolute-оверлеем поверх
                    ряда, а не добавляя высоту. */}
                <div
                    data-testid="top-hud-mobile-telemetry-row"
                    className={clsx(
                        // h-14 (56px, легальная «ячейка с числом HUD-кегля»
                        // #541) — было 49.5px натурального контента, вне
                        // легального набора.
                        'relative flex h-14 min-w-0 items-stretch gap-0',
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
                        glow
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
                        glow
                        // Доп. отступ слева (#452): тач-цель кнопок ± шире визуального
                        // бокса (`TrimButton`, псевдоэлемент 52×52) — без этого зазор
                        // между «Угол больше» и «Сила меньше» падал до 2px хит-зон
                        // вплотную к соседней ячейке (бюджет ≥8px, замер `overlay-budget`).
                        className="ml-2"
                    />
                    <WindCell wind={wind} windRevealed={windRevealed} compact />
                    {/* Снаряды и ходы — компактной карточкой (#528): та же подложка
                        HUD_SURFACE + рамка, что у соседних ячеек — раньше висели
                        прямо на небе без неё и почти терялись на светлом пресете.
                        Один бордер на пару строк, а не на каждую: две отдельные
                        карточки не влезли бы в бюджет высоты ряда (55.5px, тот же,
                        что у ячейки «Угол»). `gap-0.5` и `dense` — тот же бюджет:
                        обычный `gap-1` (как на планшете/десктопе, где карточка не в
                        стеснённом ряду) вместе с бордером row вырастил бы.
                        `flex-1` + выравнивание вправо (#528): колонка добирает остаток
                        строки, и правый край карточки совпадает с рядами выше —
                        раньше он не доходил до них 9 px и край панели выглядел рваным. */}
                    <div
                        className={clsx(
                            HUD_SURFACE,
                            'flex flex-1 flex-col items-end justify-center gap-0.5 border-[length:var(--border-w)] border-border',
                        )}
                    >
                        {/* На 320px (#537) снаряды скрыты согласно приоритету сброса
                            (п. 2: снаряды первыми как дубль информации на палубе),
                            остаются для a11y. */}
                        <div className="w-0 overflow-hidden">
                            <ResourcePips
                                label="Снаряды"
                                pips={ammoPips}
                                color="var(--color-accent)"
                                ariaLabel="снарядов"
                                size={6}
                                gap={1}
                                dense
                            />
                        </div>
                        <ResourcePips
                            label="Ходы"
                            pips={movePips}
                            color="var(--color-warning)"
                            ariaLabel="ходов манёвра"
                            size={6}
                            gap={1}
                            dense
                            hideLabel
                        />
                    </div>
                    {isBotTurn && (
                        <FrozenNote className="pointer-events-none absolute inset-x-0 bottom-0" />
                    )}
                </div>
            </div>

            {/* Планшет/десктоп (≥768): панель, без ±. 768–1279 — 2 полноширинных
                ряда (flex-col) БЕЗ переноса внутри ряда, каждый — две группы по
                краям (#538): раньше оба ряда были `flex-wrap` резиновой шириной —
                HP-блок (`min-w-[420px]`) + пилюля + бейдж + иконки не помещались
                в 768 и переносились сами по себе на 2–3 внутренних подряда, раздувая
                полосу до ~253px против объявленного зоне жеста инсета 128
                (`GESTURE_ZONE_INSET` в `game-canvas.tsx`) — верх зоны прицеливания
                лежал под панелью. Каждый ряд теперь — ровно одна строка, левая группа
                растёт (`flex-1`/`min-w-0`), правая не сжимается (`shrink-0`) —
                бюджет высоты 44 (ряд 1) + 56 (ряд 2) + зазоры укладывается в 128.
                1280/1920 — 1 ряд (xl:flex-row), центр по max-width на 1920. */}
            <div
                data-testid="top-hud-desktop"
                // xl:gap-2 (#489, было xl:gap-5): узкий xl (1280…~1413) — телеметрия
                // (shrink-0) и первый ряд (HP+пилюля+бейдж+иконки) вместе не влезали
                // в полосу 78px, зазор между ними ужат в общий бюджет экономии.
                // md:gap-1 md:py-1 (#541, легальный набор {4,8,16} — были gap-1.5/
                // py-1.5 = 6px, вне набора): 44 (ряд 1) + 4 (зазор) + 44 (ряд 2) +
                // 4+4 (паддинг) + 2 (рамка) = 102 против объявленного зоне жеста
                // инсета 128 (плюс внешний паддинг оверлея 20px = 122 итого).
                className="pointer-events-auto hidden md:flex md:w-full md:flex-col md:gap-1 md:border-b-[length:var(--border-w)] md:border-border md:bg-panel md:px-4 md:py-1 xl:mx-auto xl:h-[78px] xl:max-w-[1280px] xl:flex-row xl:items-center xl:gap-2 xl:py-0"
            >
                {/* xl:gap-1 (#489, было gap-4 без override): тот же бюджет ширины —
                    первый ряд (HP-блок + пилюля + бейдж заморозки + mute/пауза)
                    ужимается плотнее на узком xl, освобождая место телеметрии.
                    С 1440 ужатие снимается (#528): бюджет ширины там уже не жмёт, а
                    4 px в левой группе против 8 в телеметрии читались как случайный
                    сбой ритма — на широком экране панель идёт одним шагом.
                    Без `flex-wrap` (#538): HP-блок держит `flex-1` — сам растягивается
                    и толкает правую группу к краю ряда, перенос строки больше не
                    нужен для этого эффекта. */}
                <div
                    data-testid="top-hud-status-row"
                    // md:h-11 xl:h-14 + items-stretch (#541): HP-блок и кластер
                    // статуса — прямые дети этого ряда, растягиваются до общей
                    // легальной высоты (44 на планшете, 56 на xl) вместо
                    // центрирования разных по высоте боксов (55/44 на xl).
                    className="flex flex-1 items-stretch gap-4 md:h-11 xl:h-14 xl:flex-nowrap xl:gap-1 min-[1440px]:gap-2"
                >
                    {/* На 768–1279 (#538) HP-бары держат минимум только собственных
                        карточек (150px каждая, `HpCard`) — фикс `min-w-[420px]`
                        конкурировал за ширину ряда с новой правой группой
                        (пилюля+бейдж+иконки) и не помещался в 768. `xl:min-w-0` не
                        нужен отдельно — низа `min-w-0` достаточно на всех брейкпоинтах,
                        карточки сами держат минимум.
                        Два состава по CSS-видимости, тот же приём, что у самого
                        `TopHud` для мобилки/десктопа (#538): `stacked`-карточка (44px+
                        имя/значение в две строки) на 768–1279 не укладывается в бюджет
                        ряда 1 (44px, вместе с пилюлей/иконками) — `inline` (как на
                        мобилке, #450) укладывается. С xl (полоса 78px, есть запас)
                        возвращается канон `stacked`. */}
                    <div className="flex min-w-0 flex-1 gap-2 xl:hidden">
                        <HpCard
                            faction="player"
                            label={PLAYER_NAME_PLACEHOLDER}
                            value={displayedPlayerHp}
                            active={turn === 'player'}
                            layout="inline"
                            hitNonce={playerHitNonce}
                        />
                        <HpCard
                            faction="enemy"
                            label={BOT_NAME}
                            value={displayedEnemyHp}
                            active={turn === 'enemy'}
                            layout="inline"
                            hitNonce={enemyHitNonce}
                        />
                    </div>
                    <div className="hidden min-w-0 flex-1 gap-2 xl:flex">
                        <HpCard
                            faction="player"
                            label={PLAYER_NAME_PLACEHOLDER}
                            value={displayedPlayerHp}
                            active={turn === 'player'}
                            hitNonce={playerHitNonce}
                        />
                        <HpCard
                            faction="enemy"
                            label={BOT_NAME}
                            value={displayedEnemyHp}
                            active={turn === 'enemy'}
                            hitNonce={enemyHitNonce}
                        />
                    </div>
                    {/* Правая группа ряда 1 (#538): статус хода + mute/пауза — не
                        сжимается и не переносится, HP-блок слева толкает её к краю
                        своим `flex-1`. */}
                    {/* items-stretch (#541): пилюля/бейдж/иконки — прямые дети,
                        растягиваются до высоты кластера (которая сама
                        растянута до высоты статус-ряда родителем выше). */}
                    <div
                        data-testid="top-hud-status-cluster"
                        className="flex shrink-0 items-stretch gap-2"
                    >
                        <TurnPillOrNothing turn={turn} phase={phase} />
                        <FreezeBadgeOrNothing visible={showFreezeBadge} />
                        <HudIconButtons onPauseClick={onPauseClick} />
                    </div>
                </div>
                <div
                    data-testid="top-hud-telemetry-desktop"
                    className={clsx(
                        // xl:shrink-0 + xl:flex-nowrap: телеметрия — мои числа, ей
                        // нельзя тихо перенестись на вторую строку и вылезти из
                        // фиксированной высоты полосы 78px (её сжимал бы flex-1
                        // соседнего HP-блока, тот же класс бага, что и с пилюлей
                        // хода выше) — она либо помещается в ряд целиком, либо
                        // e2e-проверка переполнения должна это поймать.
                        // xl:gap-2 (#489): на узком xl (1280…~1413) телеметрия
                        // (shrink-0, не сжимается) вместе с первым рядом не влезала
                        // в полосу 78px и уезжала за правый край — ужатый зазор
                        // (16px → 8px, ×4 промежутка) освобождает часть недостающей
                        // ширины. Планшет держит исходный `gap-4` (класс без префикса).
                        // На 768–1279 (#538) `justify-between` вместо `flex-wrap`:
                        // телеметрия слева, ресурсы (снаряды/ходы) справа — один ряд,
                        // а не перенос на вторую строку.
                        // md:h-11 xl:h-14 + items-stretch (#541): группа чисел и
                        // группа ресурсов — прямые дети, растягиваются до общей
                        // легальной высоты (44/56) вместо разных 39/27 (768) и 67/25 (xl).
                        'flex w-full items-stretch justify-between gap-4 md:h-11 xl:h-14 xl:w-auto xl:shrink-0 xl:flex-nowrap xl:gap-2',
                        isBotTurn && 'opacity-60',
                    )}
                >
                    <div
                        data-testid="top-hud-telemetry-numbers"
                        className="flex min-w-0 items-stretch gap-4 xl:gap-2"
                    >
                        {/* Подпись — всегда «Угол» без суффикса «заморожен» (#473):
                            на планшете/десктопе заморозку несёт бейдж рядом с пилюлей
                            (`FreezeBadgeOrNothing`, #472), а более длинный лейбл растил бы
                            ячейку на ходе бота. Мобильный `TrimCell` оставляет `angleLabel`
                            со своей заметкой `FrozenNote` (состав не тронут). `sizer` под
                            `360°`/`POWER_MAX` держит ширину бокса значения неизменной. */}
                        <NumberCell
                            label="Угол"
                            value={angleValue}
                            valueClassName="text-accent"
                            sizer="360°"
                            glow
                        />
                        <NumberCell
                            label="Сила"
                            value={power}
                            valueClassName="text-warning"
                            sizer={POWER_MAX}
                            glow
                        />
                        <WindCell wind={wind} windRevealed={windRevealed} />
                    </div>
                    <div
                        data-testid="top-hud-telemetry-resources"
                        className="flex shrink-0 items-stretch gap-4 xl:gap-2"
                    >
                        {/* Планшет/десктоп (#528): та же `CellShell`-карточка (рамка +
                            подложка), что у Угла/Силы/Ветра — раньше снаряды и ходы были
                            единственной парой ячеек без неё. `tight` (без паддинга): на
                            узком xl (1280) телеметрия — нешринкающийся ряд, обычный
                            паддинг `CellShell` в оставшийся бюджет ширины не влезает
                            (см. докблок `tight` в `CellShell`). */}
                        {/* «Снаряды» скрыты на xl (#548, разбор §2/§3): на десктопе
                            (≥1280) селектор палубы уже показывает боезапас выбранного
                            оружия («Фугас ×2», `game-controls.tsx`) — ячейка дублирует
                            эту цифру и занимает ~90px в самом тесном месте полосы.
                            На планшете (768–1279) палуба показывает то же самое, но
                            там ячейка остаётся — бюджет ширины там не жмёт так, как на
                            узком xl (#489), а разбор ограничивает удаление явно
                            десктопом. `xl:hidden` (не размонтирование): ячейка не несёт
                            своего состояния, спрятать классом дешевле и не меняет
                            поведение ниже xl. */}
                        <CellShell label="Снаряды" tight className="xl:hidden">
                            <ResourcePipVisual
                                pips={ammoPips}
                                color="var(--color-accent)"
                                ariaLabel="снарядов"
                            />
                        </CellShell>
                        <CellShell label="Ходы" tight>
                            <ResourcePipVisual
                                pips={movePips}
                                color="var(--color-warning)"
                                ariaLabel="ходов манёвра"
                            />
                        </CellShell>
                    </div>
                </div>
            </div>
        </div>
    );
}
