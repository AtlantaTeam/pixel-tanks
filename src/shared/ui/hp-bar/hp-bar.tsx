import { clsx } from 'clsx';
import type { TFaction } from '@/shared/lib/theme';
import { Icon } from '../icon';

export type THPBarFaction = TFaction;

type THPBarProps = {
    label: string;
    value: number;
    faction: THPBarFaction;
    /** Максимум шкалы HP (дефолт 100). Заливка и цветовые пороги считаются от него,
     *  а не от сырого `value` — чтобы бар не поехал при другом балансе/режиме. */
    max?: number;
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

/** design-inventory.dc.html §HUD «HP-bar»: заливка success→warning→danger по порогам
 *  (>60% / >30% / остальное), иконка — фиксированный маркер «свой танк» (star) / «враг»
 *  (skull), НЕ тематический `--accent` — не должна перекрашиваться под data-faction
 *  предка, иначе бар врага станет неотличим от бара игрока при смене темы хода. */
export function HPBar({ label, value, faction, max = DEFAULT_HP_MAX, className }: THPBarProps) {
    const clamped = Math.min(max, Math.max(0, value));
    const percent = max > 0 ? (clamped / max) * 100 : 0;

    return (
        <div className={clsx('flex flex-col gap-[5px]', className)}>
            <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-ui text-caption font-bold text-text">
                    <Icon
                        name={faction === 'enemy' ? 'skull' : 'star'}
                        size={14}
                        className={faction === 'enemy' ? 'text-enemy' : 'text-accent'}
                    />
                    {label}
                </span>
                {/* handoff «HP-карточка»: компактно «72/100», без «HP»-префикса и
                    без пробелов вокруг «/» — строка не должна переноситься на
                    узкой карточке (`flex:1 1 180px`). */}
                <span className="font-ui text-[10px] whitespace-nowrap text-text-muted tabular-nums">
                    {clamped}/{max}
                </span>
            </div>
            <div
                role="progressbar"
                aria-label={`${label}: HP ${clamped} из ${max}`}
                aria-valuenow={clamped}
                aria-valuemin={0}
                aria-valuemax={max}
                className="h-3 border-[length:var(--border-w)] border-border bg-surface"
            >
                <div
                    data-testid="hp-bar-fill"
                    className={clsx('h-full', hpFillClass(percent))}
                    style={{ width: `${percent}%` }}
                />
            </div>
        </div>
    );
}
