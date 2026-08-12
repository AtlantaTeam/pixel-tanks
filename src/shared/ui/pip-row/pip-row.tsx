import { clsx } from 'clsx';

type TPipRowProps = {
    pips: boolean[];
    color?: string;
    /** Размер пипа в px (дефолт 14 — канон кода). Ячейка ВЕТЕР до пристрелки
     *  (handoff «Пипы») рисует уменьшенные 10×10 — та же грубая шкала, что и
     *  после раскрытия, просто до выстрела ещё нет точного числа. */
    size?: number;
    /** Зазор между пипами в px (дефолт 5). Компактный мобильный HUD (#450) ужимает
     *  его, чтобы ряды снарядов/ходов встали в общую строку телеметрии. */
    gap?: number;
    /** Что считают пипы — для aria-label скринридера (напр. «снарядов», «ходов»). */
    label?: string;
    className?: string;
};

const DEFAULT_PIP_SIZE = 14;
const DEFAULT_PIP_GAP = 5;

/**
 * design-inventory.dc.html §HUD «PipRow»: ряд пипов для снарядов/ходов.
 * Активный пип — заполненный квадрат (дефолт 14×14px, `size-3.5`) с цветом и
 * glow, неактивный — полупрозрачный контур. Дефолтный размер — на Tailwind-
 * утилите (стабильна для существующих потребителей); нестандартный — inline
 * `style`, вместе с динамическим цветом из пропа `color`.
 */
export function PipRow({
    pips,
    color = 'var(--accent)',
    size = DEFAULT_PIP_SIZE,
    gap = DEFAULT_PIP_GAP,
    label,
    className,
}: TPipRowProps) {
    const activeCount = pips.filter(Boolean).length;
    const ariaLabel = `${activeCount} из ${pips.length}${label ? ` ${label}` : ''}`;
    const isDefaultSize = size === DEFAULT_PIP_SIZE;
    const isDefaultGap = gap === DEFAULT_PIP_GAP;

    return (
        <div
            role="img"
            aria-label={ariaLabel}
            className={clsx('flex', isDefaultGap && 'gap-[5px]', className)}
            style={isDefaultGap ? undefined : { gap }}
        >
            {pips.map((isActive, index) => (
                <span
                    key={`pip-${index}`}
                    data-testid="pip"
                    className={clsx(
                        'inline-block border-2',
                        isDefaultSize && 'size-3.5',
                        isActive ? 'shadow-[var(--glow)]' : 'border-border-strong opacity-50',
                    )}
                    style={{
                        ...(isDefaultSize ? undefined : { width: size, height: size }),
                        ...(isActive ? { background: color, borderColor: color } : undefined),
                    }}
                />
            ))}
        </div>
    );
}
