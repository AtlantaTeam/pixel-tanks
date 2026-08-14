import { HUD_SURFACE } from '@/shared/config';

/**
 * Разовая подсказка прицеливания (issue #565): показывается один раз (флаг
 * `aim-hint`, переживает перезагрузку) у верха зоны жеста. Заменяет обучающие
 * строки, которые раньше висели в чипе на каждом жесте каждого боя и накрывали
 * танк на мобиле. У верха зоны — не над стволом и не под пальцем: читается до
 * первого выстрела и больше не мешает.
 *
 * `pointer-events:none` — подсказка не перехватывает жест, его ловит канвас.
 */
type TAimHintProps = {
    visible: boolean;
};

export function AimHint({ visible }: TAimHintProps) {
    if (!visible) return null;

    return (
        <div
            data-testid="aim-hint"
            aria-hidden
            className={`pointer-events-none absolute top-[252px] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 border-2 border-accent px-3 py-2 text-center md:top-[138px] lg:top-[88px] ${HUD_SURFACE}`}
        >
            <span className="font-ui text-[11px] font-bold tracking-[0.12em] text-accent uppercase [text-shadow:var(--glow-text)]">
                Оттяни и отпусти — выстрел
            </span>
            <span className="font-ui text-[9px] leading-tight tracking-[0.06em] text-text-dim">
                показываем только направление, не точку падения
            </span>
        </div>
    );
}
