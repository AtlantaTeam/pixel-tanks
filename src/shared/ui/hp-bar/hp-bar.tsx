import { clsx } from 'clsx';
import { Icon } from '../icon';

export type THPBarFaction = 'player' | 'enemy';

type THPBarProps = {
    label: string;
    value: number;
    faction: THPBarFaction;
    className?: string;
};

const HP_MAX = 100;
const WARNING_THRESHOLD = 60;
const DANGER_THRESHOLD = 30;

function hpFillClass(value: number) {
    if (value > WARNING_THRESHOLD) return 'bg-success';
    if (value > DANGER_THRESHOLD) return 'bg-warning';
    return 'bg-danger';
}

/** design-inventory.dc.html §HUD «HP-bar»: заливка success→warning→danger по порогам
 *  (>60 / >30 / остальное), иконка — фиксированный маркер «свой танк» (star) / «враг»
 *  (skull), НЕ тематический `--accent` — не должна перекрашиваться под data-faction
 *  предка, иначе бар врага станет неотличим от бара игрока при смене темы хода. */
export function HPBar({ label, value, faction, className }: THPBarProps) {
    const clamped = Math.min(HP_MAX, Math.max(0, value));

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
                <span className="font-ui text-label text-text-muted tabular-nums">
                    HP {clamped} / {HP_MAX}
                </span>
            </div>
            <div className="h-3 border-[length:var(--border-w)] border-border bg-surface">
                <div
                    data-testid="hp-bar-fill"
                    className={clsx('h-full', hpFillClass(clamped))}
                    style={{ width: `${clamped}%` }}
                />
            </div>
        </div>
    );
}
