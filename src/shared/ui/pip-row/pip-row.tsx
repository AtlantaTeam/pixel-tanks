import { clsx } from 'clsx';

type TPipRowProps = {
    pips: boolean[];
    color?: string;
    /** Что считают пипы — для aria-label скринридера (напр. «снарядов», «ходов»). */
    label?: string;
    className?: string;
};

/**
 * design-inventory.dc.html §HUD «PipRow»: ряд пипов для снарядов/ходов.
 * Активный пип — заполненный квадрат 14×14px (`size-3.5`) с цветом и glow,
 * неактивный — полупрозрачный контур. Статичная геометрия — на Tailwind-утилитах;
 * inline-`style` держит только динамический цвет из пропа `color`.
 */
export function PipRow({ pips, color = 'var(--accent)', label, className }: TPipRowProps) {
    const activeCount = pips.filter(Boolean).length;
    const ariaLabel = `${activeCount} из ${pips.length}${label ? ` ${label}` : ''}`;

    return (
        <div role="img" aria-label={ariaLabel} className={clsx('flex gap-[5px]', className)}>
            {pips.map((isActive, index) => (
                <span
                    key={`pip-${index}`}
                    data-testid="pip"
                    className={clsx(
                        'inline-block size-3.5 border-2',
                        isActive ? 'shadow-[var(--glow)]' : 'border-border-strong opacity-50',
                    )}
                    style={isActive ? { background: color, borderColor: color } : undefined}
                />
            ))}
        </div>
    );
}
