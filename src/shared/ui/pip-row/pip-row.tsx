import { clsx } from 'clsx';

type TPipRowProps = {
    pips: boolean[];
    color?: string;
    className?: string;
};

/**
 * design-inventory.dc.html §HUD «PipRow»: ряд пипов для снарядов/ходов.
 * Активный пип — заполненный квадрат 14×14px с цветом и glow,
 * неактивный — полупрозрачный контур.
 */
export function PipRow({ pips, color = 'var(--accent)', className }: TPipRowProps) {
    return (
        <div className={clsx('flex gap-[4px]', className)}>
            {pips.map((isActive, index) => (
                <span
                    key={index}
                    data-testid="pip"
                    style={{
                        width: '14px',
                        height: '14px',
                        display: 'inline-block',
                        background: isActive ? color : 'transparent',
                        border: `2px solid ${isActive ? color : 'var(--color-border-strong)'}`,
                        boxShadow: isActive ? 'var(--glow)' : 'none',
                        opacity: isActive ? 1 : 0.5,
                    }}
                />
            ))}
        </div>
    );
}
