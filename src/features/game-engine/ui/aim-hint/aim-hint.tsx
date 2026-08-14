import { HUD_SURFACE } from '@/shared/config';

/** Факт, который несёт подсказка — единственный в своём роде носитель для AT. */
const AIM_HINT_FACT =
    'Прицел показывает только направление выстрела, не точку падения — доводи силу сам.';

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
 * Это ВИЗУАЛЬНАЯ плашка (`aria-hidden`: двухстрочная вёрстка, глиф-стиль — шум
 * для AT). Факт для скринридера несёт отдельный `AimHintAnnouncer`, который
 * смонтирован в дереве ВСЕГДА (см. его докблок) — эта плашка условная, поэтому
 * live-region внутри неё скринридером бы не читался.
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
                Прицел — только направление
            </span>
            <span className="font-ui text-[9px] leading-tight tracking-[0.06em] text-text-dim">
                точку падения не показываем — доводи сам
            </span>
        </div>
    );
}

/**
 * Анонс подсказки прицеливания для скринридера (a11y, ревью #574) — по тому же
 * правилу, что `FreezeAnnouncer`/`WindShiftAnnouncer` в `top-hud`: live-region
 * обязан существовать в дереве доступности ДО появления текста, иначе анонса нет —
 * скринридеры молчат на ПОЯВЛЕНИИ узла, озвучивается только смена содержимого уже
 * смонтированного региона.
 *
 * Поэтому этот `<span aria-live>` рендерится в `game-canvas` БЕЗУСЛОВНО (пуст, пока
 * подсказка не активна), а не внутри условной плашки `AimHint` — та возвращает
 * `null`, пока не видима, и вставленный вместе с ней live-region остался бы
 * неозвученным. Текст появляется, когда подсказка активна (`active`), и уходит
 * после первого выстрела.
 */
type TAimHintAnnouncerProps = {
    active: boolean;
};

export function AimHintAnnouncer({ active }: TAimHintAnnouncerProps) {
    return (
        <span data-testid="aim-hint-live" aria-live="polite" aria-atomic="true" className="sr-only">
            {active ? AIM_HINT_FACT : ''}
        </span>
    );
}
