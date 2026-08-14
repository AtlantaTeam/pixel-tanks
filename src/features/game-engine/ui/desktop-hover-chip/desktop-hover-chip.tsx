import { clsx } from 'clsx';
import { HUD_SURFACE } from '@/shared/config';
import { CHIP_WIDTH } from '../gesture-overlay';
import { formatAngle } from '../../lib/format-angle';

/** Визуальный состав чипа наведения мышью на десктопе (аналог чипа жеста на мобиле). */
export type TDesktopHoverChipVisual = {
    /** Горизонтальный центр чипа (уже прижат к зоне — `clampChipCenterX`). */
    chipCenterX: number;
    /** Верх чипа (уже прижат к зоне — `clampChipTop`). */
    chipTop: number;
    angle: number;
    power: number;
    /** Превышение максимума: чип краснеет, показывает «МАКС». */
    isMax: boolean;
};

type TDesktopHoverChipProps = {
    visual: TDesktopHoverChipVisual | null;
};

/**
 * Чип наведения мышью на десктопе (#544): компактный чип «360° · 010»
 * у ствола танка. Переиспользует стиль мобильного чипа жеста, но показывается
 * при наведении мышью (не при жесте).
 */
export function DesktopHoverChip({ visual }: TDesktopHoverChipProps) {
    if (!visual) return null;

    const { chipTop, chipCenterX, angle, power, isMax } = visual;

    return (
        <div
            data-testid="desktop-hover-chip"
            className="pointer-events-none absolute"
            style={{
                left: chipCenterX,
                top: chipTop,
                transform: 'translateX(-50%)',
            }}
        >
            <div
                className={clsx(
                    'flex flex-col items-center gap-1 border-2 px-3 py-2 text-center',
                    HUD_SURFACE,
                    isMax ? 'border-danger' : 'border-accent',
                )}
                // Ширина — та же константа, что у чипа жеста (#544): чипы обязаны быть
                // одной ширины, и держать это комментарием об «одинаковых 200» уже
                // пробовали — число разъезжается молча.
                style={{
                    width: CHIP_WIDTH,
                }}
            >
                <div className="flex items-baseline gap-2 font-ui font-bold tabular-nums [text-shadow:var(--glow-text)]">
                    <span className={isMax ? 'text-danger' : 'text-accent'}>
                        <span className="text-[22px] leading-none">{formatAngle(angle)}</span>
                        <span className="text-[13px]">°</span>
                    </span>
                    <span
                        className={clsx(
                            'text-[22px] leading-none',
                            isMax ? 'text-danger' : 'text-warning',
                        )}
                    >
                        {isMax ? 'МАКС' : power}
                    </span>
                </div>
            </div>
        </div>
    );
}
