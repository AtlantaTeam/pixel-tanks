import { HUD_SURFACE } from '@/shared/config';

/**
 * Разовая подсказка прицеливания (issue #565): показывается один раз (флаг
 * `aim-hint`, переживает перезагрузку) у верха зоны жеста. Заменяет обучающие
 * строки, которые раньше висели в чипе на каждом жесте каждого боя и накрывали
 * танк на мобиле. У верха зоны — не над стволом и не под пальцем: читается до
 * первого выстрела и больше не мешает.
 *
 * Несёт ровно то, чего нет больше нигде — что предпросмотр показывает НАПРАВЛЕНИЕ,
 * а не точку падения (вердикт GDD). «Как стрелять» уже сказано постоянно: на
 * мобиле — строкой палубы «тяни по арене — отпусти, чтобы выстрелить», на
 * десктопе — легендой управления на палубе. Поэтому текст device-neutral и не
 * повторяет ни то, ни другое.
 *
 * `pointer-events:none` — подсказка не перехватывает жест, его ловит канвас.
 *
 * Визуальная плашка `aria-hidden` (двухстрочная вёрстка, глиф-стиль — шум для AT),
 * но факт, который она несёт, единственный в своём роде, поэтому его же отдаём
 * скринридеру отдельной `sr-only`-строкой — как заморозку и смену ветра в `top-hud`
 * (`FreezeAnnouncer`/`WindShiftAnnouncer`). Иначе единственный носитель «предпросмотр
 * показывает направление, а не точку падения» пропадал бы для AT под `aria-hidden`.
 */
type TAimHintProps = {
    visible: boolean;
};

export function AimHint({ visible }: TAimHintProps) {
    if (!visible) return null;

    return (
        <>
            <div
                data-testid="aim-hint"
                aria-hidden
                className={`pointer-events-none absolute top-[252px] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 border-2 border-accent px-3 py-2 text-center md:top-[138px] lg:top-[88px] ${HUD_SURFACE}`}
            >
                <span className="font-ui text-[11px] font-bold tracking-[0.12em] text-accent uppercase [text-shadow:var(--glow-text)]">
                    Прицел — только направление
                </span>
                <span className="font-ui text-[9px] leading-tight tracking-[0.06em] text-text-dim">
                    точку падения не показываем — доводи сам
                </span>
            </div>
            <span data-testid="aim-hint-live" aria-live="polite" className="sr-only">
                Прицел показывает только направление выстрела, не точку падения — доводи силу сам.
            </span>
        </>
    );
}
