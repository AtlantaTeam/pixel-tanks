'use client';

import { clsx } from 'clsx';
import { formatAngle } from '../../lib/format-angle';

/**
 * Визуал жеста «оттяни-отпусти» (handoff «Прицеливание `aim`»): DOM/SVG-оверлей
 * поверх канваса — луч оттяжки, кольцо пальца и чип предпросмотра. Здесь, а не на
 * канвасе, потому что этим элементам нужны токены дизайн-системы и текст
 * (`var(--accent)`, `--glow`, `tabular-nums`, шрифты). Короткий сегмент направления
 * от ствола рисует движок (`game-play.drawAimPreview`) — он заякорен на стволе в
 * canvas-координатах. Все координаты здесь — ЛОКАЛЬНЫЕ (относительно контейнера
 * канваса), расчёт вынесен в чистые функции `lib/gesture-aim.ts` (рендер отделён
 * от расчёта — `.claude/rules/canvas.md`).
 *
 * `pointer-events:none` на всех слоях — жест ловит сам канвас через pointer capture,
 * оверлей не должен перехватывать события.
 */

/** Все поля в локальных px контейнера канваса. */
export type TGestureVisual = {
    /** Точка касания (старт оттяжки) — начало луча и точка 8×8. */
    originX: number;
    originY: number;
    /** Текущая позиция пальца — центр кольца и якорь чипа. */
    fingerX: number;
    fingerY: number;
    /** Верх чипа (уже прижат к зоне — `clampChipTop`). */
    chipTop: number;
    /** Горизонтальный центр чипа (уже прижат к зоне — `clampChipCenterX`). */
    chipCenterX: number;
    angle: number;
    power: number;
    /** Превышение максимума: луч и чип краснеют, чип показывает «МАКС». */
    isMax: boolean;
};

/** Размер точки старта луча (handoff: «точка старта 8×8»). */
const START_DOT = 8;
/** Кольцо пальца (handoff: «56×56, border:2px dashed»). */
const RING_SIZE = 56;
/**
 * Фиксированная ширина чипа (px). Совпадает с `CHIP_WIDTH` в `game-canvas`
 * (`clampChipCenterX`): чип центрируется над пальцем, поэтому клэмп должен знать
 * его ровную ширину, иначе край уезжает за зону (горизонтальное переполнение).
 */
export const CHIP_WIDTH = 200;

type TGestureOverlayProps = {
    visual: TGestureVisual | null;
};

export function GestureOverlay({ visual }: TGestureOverlayProps) {
    if (!visual) return null;

    const { originX, originY, fingerX, fingerY, chipTop, chipCenterX, angle, power, isMax } =
        visual;
    // Луч и чип краснеют при превышении максимума (handoff): семантический токен,
    // не хардкод hex.
    const strokeColor = isMax ? 'var(--color-danger)' : 'var(--color-accent)';

    return (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
            {/* Луч оттяжки от точки касания к пальцу + точка старта 8×8. */}
            <svg
                className="absolute inset-0 h-full w-full overflow-visible"
                style={{ filter: `drop-shadow(0 0 6px ${strokeColor})` }}
            >
                <line
                    x1={originX}
                    y1={originY}
                    x2={fingerX}
                    y2={fingerY}
                    stroke={strokeColor}
                    strokeWidth={2}
                />
                <rect
                    x={originX - START_DOT / 2}
                    y={originY - START_DOT / 2}
                    width={START_DOT}
                    height={START_DOT}
                    fill={strokeColor}
                />
            </svg>

            {/* Кольцо пальца — всегда accent (краснеет только луч и чип). */}
            <div
                className="absolute rounded-full border-2 border-dashed border-accent opacity-70"
                style={{
                    left: fingerX,
                    top: fingerY,
                    width: RING_SIZE,
                    height: RING_SIZE,
                    transform: 'translate(-50%, -50%)',
                }}
            />

            {/* Чип предпросмотра — выше пальца, прижат к зоне (не под палубу).
                Фиксированная ширина (CHIP_WIDTH) центрируется над пальцем: клэмп
                держит его в границах зоны, длинная подпись переносится внутрь. */}
            <div
                className={clsx(
                    'absolute flex flex-col items-center gap-1 border-2 px-3 py-2 text-center',
                    'bg-[rgba(8,12,8,0.80)] backdrop-blur-[4px] shadow-[0_0_0_1px_rgba(0,0,0,.9)]',
                    isMax ? 'border-danger' : 'border-accent',
                )}
                style={{
                    left: chipCenterX,
                    top: chipTop,
                    width: CHIP_WIDTH,
                    transform: 'translateX(-50%)',
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
                <span
                    className={clsx(
                        'font-ui text-[9px] font-bold tracking-[0.12em] uppercase',
                        isMax ? 'text-danger' : 'text-text-muted',
                    )}
                >
                    ОТПУСТИ — ВЫСТРЕЛ
                </span>
                <span className="font-ui text-[8px] leading-tight tracking-[0.06em] text-text-dim">
                    только направление · падение не показываем
                </span>
            </div>
        </div>
    );
}
