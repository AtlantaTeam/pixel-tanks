import { clsx } from 'clsx';
import type { TFaction } from '@/shared/lib/theme';
import { Icon } from '../icon';

export type THPBarFaction = TFaction;
/** `stacked` (дефолт) — имя+число над треком (планшет/десктоп); `inline` — имя,
 *  трек и число в одну строку. Компактная раскладка мобильного HUD (#450): убирает
 *  вертикальный ряд-заголовок, экономя высоту оверлея. */
export type THPBarLayout = 'stacked' | 'inline';

type THPBarProps = {
    label: string;
    value: number;
    faction: THPBarFaction;
    /** Максимум шкалы HP (дефолт 100). Заливка и цветовые пороги считаются от него,
     *  а не от сырого `value` — чтобы бар не поехал при другом балансе/режиме. */
    max?: number;
    layout?: THPBarLayout;
    className?: string;
};

const DEFAULT_HP_MAX = 100;
/** Пороги перекраски — в процентах от `max`: success > 60%, warning > 30%, иначе danger. */
const WARNING_THRESHOLD = 60;
const DANGER_THRESHOLD = 30;

function hpFillClass(percent: number) {
    if (percent > WARNING_THRESHOLD) return 'bg-success';
    if (percent > DANGER_THRESHOLD) return 'bg-warning';
    return 'bg-danger';
}

/** Иконка стороны (star/skull) + имя с усечением — фиксированный маркер «свой
 *  танк»/«враг», НЕ тематический `--accent` (не перекрашивается под data-faction
 *  предка). `min-w-0` — обязателен, чтобы `text-ellipsis` сработал во flex-строке. */
function HpName({ label, faction }: { label: string; faction: THPBarFaction }) {
    return (
        <span className="flex min-w-0 items-center gap-1.5 font-ui text-caption font-bold text-text">
            <Icon
                name={faction === 'enemy' ? 'skull' : 'star'}
                size={14}
                className={clsx('shrink-0', faction === 'enemy' ? 'text-enemy' : 'text-accent')}
            />
            {/* handoff «HP-карточка»: имя — ник профиля, длина не гарантирована —
                обрезаем многоточием, а не переносим на узкой карточке. */}
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
        </span>
    );
}

/** handoff «HP-карточка»: компактно «72/100» (без «HP»-префикса и пробелов вокруг
 *  «/»). Ширина зарезервирована под максимум диапазона («100/100») и выровнена
 *  вправо (#447): при смене значения число моноширинных цифр не двигает соседей —
 *  HUD не «скачет». */
function HpCaption({ clamped, max }: { clamped: number; max: number }) {
    return (
        <span
            className="inline-block shrink-0 text-right font-ui text-[10px] whitespace-nowrap text-text-muted tabular-nums"
            // Резерв «N/N»: цифры max, «/», цифры max = length*2 + 1. `ch` тут =
            // ширина цифры только потому, что font-ui (JetBrains Mono) моноширинный
            // (и «/» = 1ch, `tabular-nums` избыточен, но не мешает). Станет HUD-шрифт
            // пропорциональным — резерв разъедется.
            style={{ minWidth: `${String(max).length * 2 + 1}ch` }}
        >
            {clamped}/{max}
        </span>
    );
}

function HpTrack({
    label,
    clamped,
    max,
    percent,
    className,
}: {
    label: string;
    clamped: number;
    max: number;
    percent: number;
    className?: string;
}) {
    return (
        <div
            role="progressbar"
            aria-label={`${label}: HP ${clamped} из ${max}`}
            aria-valuenow={clamped}
            aria-valuemin={0}
            aria-valuemax={max}
            className={clsx(
                'h-3 border-[length:var(--border-w)] border-border bg-surface',
                className,
            )}
        >
            <div
                data-testid="hp-bar-fill"
                className={clsx('h-full', hpFillClass(percent))}
                style={{ width: `${percent}%` }}
            />
        </div>
    );
}

/** design-inventory.dc.html §HUD «HP-bar»: заливка success→warning→danger по порогам
 *  (>60% / >30% / остальное), иконка — фиксированный маркер «свой танк» (star) / «враг»
 *  (skull), НЕ тематический `--accent` — не должна перекрашиваться под data-faction
 *  предка, иначе бар врага станет неотличим от бара игрока при смене темы хода. */
export function HPBar({
    label,
    value,
    faction,
    max = DEFAULT_HP_MAX,
    layout = 'stacked',
    className,
}: THPBarProps) {
    const clamped = Math.min(max, Math.max(0, value));
    const percent = max > 0 ? (clamped / max) * 100 : 0;

    if (layout === 'inline') {
        // Компактная строка (#450): имя (усекается) — трек (`flex-1`, тянется) —
        // число. Один ряд вместо двух: высота карточки падает почти вдвое, а
        // информация та же (имя, полоса, число).
        return (
            <div className={clsx('flex items-center gap-2', className)}>
                <HpName label={label} faction={faction} />
                <HpTrack
                    label={label}
                    clamped={clamped}
                    max={max}
                    percent={percent}
                    className="min-w-10 flex-1"
                />
                <HpCaption clamped={clamped} max={max} />
            </div>
        );
    }

    return (
        <div className={clsx('flex flex-col gap-[5px]', className)}>
            <div className="flex items-center justify-between gap-1.5">
                <HpName label={label} faction={faction} />
                <HpCaption clamped={clamped} max={max} />
            </div>
            <HpTrack label={label} clamped={clamped} max={max} percent={percent} />
        </div>
    );
}
