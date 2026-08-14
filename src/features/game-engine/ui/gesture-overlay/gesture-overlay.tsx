'use client';

import { POWER_MAX } from '@/shared/config';

/**
 * Визуал жеста «оттяни-отпусти» (handoff «Прицеливание `aim`»): DOM/SVG-оверлей
 * поверх канваса — луч оттяжки и кольцо пальца. Здесь, а не на канвасе, потому что
 * этим элементам нужны токены дизайн-системы (`var(--accent)`, `--glow`). Короткий
 * сегмент направления и подпись «угол · сила» рисует движок у ствола
 * (`game-play.drawAimPreview`/`drawBarrelReadout`) — они заякорены на стволе в
 * canvas-координатах. Все координаты здесь — ЛОКАЛЬНЫЕ (относительно контейнера
 * канваса), расчёт вынесен в чистые функции `lib/gesture-aim.ts` (рендер отделён
 * от расчёта — `.claude/rules/canvas.md`).
 *
 * Чип предпросмотра «угол · сила» удалён (issue #565): его числа дублировали
 * верхнюю панель и подпись у ствола, а на мобиле в момент полной оттяжки чип
 * ложился прямо на танк. Обучающие строки переехали в разовую подсказку
 * (`ui/aim-hint`) у верха зоны.
 *
 * `pointer-events:none` на всех слоях — жест ловит сам канвас через pointer capture,
 * оверлей не должен перехватывать события.
 */

/** Все поля в локальных px контейнера канваса. */
export type TGestureVisual = {
    /** Точка касания (старт оттяжки) — начало луча и точка 8×8. */
    originX: number;
    originY: number;
    /** Текущая позиция пальца — центр кольца. */
    fingerX: number;
    fingerY: number;
    angle: number;
    power: number;
    /** Превышение максимума: луч краснеет. */
    isMax: boolean;
};

/** Размер точки старта луча (handoff: «точка старта 8×8»). */
const START_DOT = 8;
/** Кольцо пальца (handoff: «56×56, border:2px dashed»). */
const RING_SIZE = 56;
/** Толщина луча натяжения по силе (issue #475): от тонкого к жирному. */
const TENSION_MIN_WIDTH = 2;
const TENSION_MAX_WIDTH = 7;

type TGestureOverlayProps = {
    visual: TGestureVisual | null;
};

export function GestureOverlay({ visual }: TGestureOverlayProps) {
    if (!visual) return null;

    const { originX, originY, fingerX, fingerY, power, isMax } = visual;
    // Луч краснеет при превышении максимума (handoff): семантический токен,
    // не хардкод hex.
    const strokeColor = isMax ? 'var(--color-danger)' : 'var(--color-accent)';
    // Толщина луча натяжения растёт с силой (issue #475): сильнее оттяжка — жирнее
    // «резинка рогатки». Доля силы в [0,1] линейно отображается в диапазон толщины.
    const tension = Math.min(1, Math.max(0, power / POWER_MAX));
    const tensionWidth = TENSION_MIN_WIDTH + tension * (TENSION_MAX_WIDTH - TENSION_MIN_WIDTH);

    return (
        <div
            className="pointer-events-none absolute inset-0"
            data-testid="gesture-overlay"
            aria-hidden
        >
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
                    strokeWidth={tensionWidth}
                    strokeLinecap="round"
                />
                <rect
                    x={originX - START_DOT / 2}
                    y={originY - START_DOT / 2}
                    width={START_DOT}
                    height={START_DOT}
                    fill={strokeColor}
                />
            </svg>

            {/* Кольцо пальца — всегда accent (краснеет только луч). */}
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
        </div>
    );
}
