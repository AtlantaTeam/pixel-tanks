// Клиентский: вспышка попадания живёт состоянием и таймером (см. `HpTrack`). До #549
// компонент был чисто презентационным и рендерился на сервере — стал stateful, значит
// директива обязательна, иначе сборка падает на серверной ветке `replay-page`.
'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import type { TFaction } from '@/shared/lib/theme';
import { Icon } from '../icon';

export type THPBarFaction = TFaction;
/** `stacked` (дефолт) — имя+число над треком (планшет/десктоп); `inline` — имя,
 *  трек и число в одну строку. Компактная раскладка мобильного HUD (#450): убирает
 *  вертикальный ряд-заголовок, экономя высоту оверлея. */
export type THPBarLayout = 'stacked' | 'inline';

type THPBarProps = {
    label: string;
    value: number;
    faction: THPBarFaction;
    /** Максимум шкалы HP (дефолт 100). Заливка и цветовые пороги считаются от него,
     *  а не от сырого `value` — чтобы бар не поехал при другом балансе/режиме. */
    max?: number;
    layout?: THPBarLayout;
    className?: string;
    /** Счётчик попаданий по этой стороне (issue #549) — см. докблок `HpTrack`. */
    hitNonce?: number;
};

const DEFAULT_HP_MAX = 100;
/** Сколько живут классы анимации попадания. Ровно длительность самой длинной из двух
 *  (`animate-hp-hit-flash` 200ms против `animate-hp-hit-shake` 33ms, globals.css) —
 *  держать дольше незачем, а держать бесконечно нельзя: см. докблок в `HpTrack`. */
const HP_HIT_ANIMATION_MS = 200;
/** Пороги перекраски — в процентах от `max`: success > 60%, warning > 30%, иначе danger. */
const WARNING_THRESHOLD = 60;
const DANGER_THRESHOLD = 30;

function hpFillClass(percent: number) {
    if (percent > WARNING_THRESHOLD) return 'bg-success';
    if (percent > DANGER_THRESHOLD) return 'bg-warning';
    return 'bg-danger';
}

/** Иконка стороны (star/skull) + имя с усечением — фиксированный маркер «свой
 *  танк»/«враг», НЕ тематический `--accent` (не перекрашивается под data-faction
 *  предка). `min-w-0` — обязателен, чтобы `text-ellipsis` сработал во flex-строке.
 *  Максимальная ширина ника (#540): 6ch на мобилке, 16ch на планшете/десктопе —
 *  разделение по приоритету сброса. Целиком ник виден с 1024: на 1280 и 1920 клипа
 *  нет, замерено e2e.
 *  ⚠️ На 768 верхняя граница НЕ работает: фактическую ширину решает не `max-w`, а
 *  сжатие во флекс-ряду — первый ряд отдаёт место пилюле и иконкам (#538), а `min-w-0`
 *  разрешает карточке схлопнуться, и бокс ника садится до 25px при содержимом 104px.
 *  Разбирается в issue #561; до решения факт зафиксирован в `top-hud-viewports.spec.ts`. */
function HpName({ label, faction }: { label: string; faction: THPBarFaction }) {
    return (
        <span className="flex min-w-0 max-w-[6ch] md:max-w-[16ch] items-center gap-1.5 font-ui text-caption font-bold text-text">
            <Icon
                name={faction === 'enemy' ? 'skull' : 'star'}
                size={14}
                className={clsx('shrink-0', faction === 'enemy' ? 'text-enemy' : 'text-accent')}
            />
            {/* handoff «HP-карточка»: имя — ник профиля, длина не гарантирована —
                обрезаем многоточием, а не переносим на узкой карточке.
                testid — на клипающем боксе (#540): усечение здесь чисто CSS'ное и следа
                в textContent не оставляет, проверить его можно только замером
                scrollWidth против clientWidth ИМЕННО этого узла. */}
            <span data-testid="hp-name" className="overflow-hidden text-ellipsis whitespace-nowrap">
                {label}
            </span>
        </span>
    );
}

/** handoff «HP-карточка»: компактно «72/100» (без «HP»-префикса и пробелов вокруг
 *  «/»). Ширина зарезервирована под максимум диапазона («100/100») и выровнена
 *  вправо (#447): при смене значения число моноширинных цифр не двигает соседей —
 *  HUD не «скачет». */
function HpCaption({ clamped, max }: { clamped: number; max: number }) {
    return (
        <span
            className="inline-block shrink-0 text-right font-ui text-[10px] whitespace-nowrap text-text-muted tabular-nums"
            // Резерв «N/N»: цифры max, «/», цифры max = length*2 + 1. `ch` тут =
            // ширина цифры только потому, что font-ui (JetBrains Mono) моноширинный
            // (и «/» = 1ch, `tabular-nums` избыточен, но не мешает). Станет HUD-шрифт
            // пропорциональным — резерв разъедется.
            style={{ minWidth: `${String(max).length * 2 + 1}ch` }}
        >
            {clamped}/{max}
        </span>
    );
}

function HpTrack({
    label,
    clamped,
    max,
    percent,
    className,
    hitNonce,
}: {
    label: string;
    clamped: number;
    max: number;
    percent: number;
    className?: string;
    /** Счётчик попаданий по этой стороне (issue #549, §7.2 разбора #534) —
     *  растёт на каждый хит. `key={hitNonce}` пересоздаёт трек на каждое новое
     *  значение — тот же приём, что `WindShiftBanner` у `windShiftNonce`:
     *  свежий DOM-узел заново стартует CSS-анимацию сдвига/засветки, даже если
     *  предыдущий хит по той же стороне ещё не отыграл. `undefined`/не
     *  меняется → полоса спокойна. */
    hitNonce?: number;
}) {
    // Классы анимации живут РОВНО длительность анимации, а не «до следующего хита».
    //
    // Иначе они остаются на узле навсегда, а `top-hud` держит смонтированными сразу
    // несколько составов (`md:hidden`/`xl:hidden`). В `display:none` CSS-анимация не
    // идёт и стартует с нуля при показе: попадание на планшете → поворот экрана или
    // ресайз через брейкпоинт → белая вспышка и сдвиг трека БЕЗ события. Игрок читает
    // это как «в меня попали», хотя ничего не произошло.
    // Стартовое значение, а не `setState` в эффекте: узел и так пересоздаётся на каждый
    // хит (`key={hitNonce}` ниже), поэтому «включить» вспышку достаточно начальным значением —
    // эффект только ГАСИТ её по таймеру.
    const [flashing, setFlashing] = useState(hitNonce != null);
    useEffect(() => {
        if (hitNonce == null) return;
        const timer = setTimeout(() => setFlashing(false), HP_HIT_ANIMATION_MS);
        return () => clearTimeout(timer);
    }, [hitNonce]);

    return (
        <div
            key={hitNonce}
            role="progressbar"
            aria-label={`${label}: HP ${clamped} из ${max}`}
            aria-valuenow={clamped}
            aria-valuemin={0}
            aria-valuemax={max}
            className={clsx(
                'relative h-3 border-[length:var(--border-w)] border-border bg-surface',
                flashing && 'animate-hp-hit-shake motion-reduce:animate-none',
                className,
            )}
        >
            <div
                data-testid="hp-bar-fill"
                className={clsx('h-full', hpFillClass(percent))}
                style={{ width: `${percent}%` }}
            />
            {flashing && (
                <div
                    aria-hidden
                    data-testid="hp-bar-hit-flash"
                    className="pointer-events-none absolute inset-0 bg-white animate-hp-hit-flash motion-reduce:hidden"
                />
            )}
        </div>
    );
}

/** design-inventory.dc.html §HUD «HP-bar»: заливка success→warning→danger по порогам
 *  (>60% / >30% / остальное), иконка — фиксированный маркер «свой танк» (star) / «враг»
 *  (skull), НЕ тематический `--accent` — не должна перекрашиваться под data-faction
 *  предка, иначе бар врага станет неотличим от бара игрока при смене темы хода. */
export function HPBar({
    label,
    value,
    faction,
    max = DEFAULT_HP_MAX,
    layout = 'stacked',
    className,
    hitNonce,
}: THPBarProps) {
    const clamped = Math.min(max, Math.max(0, value));
    const percent = max > 0 ? (clamped / max) * 100 : 0;

    if (layout === 'inline') {
        // Компактная строка (#450): имя (усекается) — трек (`flex-1`, тянется) —
        // число. Один ряд вместо двух: высота карточки падает почти вдвое, а
        // информация та же (имя, полоса, число).
        return (
            <div className={clsx('flex items-center gap-2', className)}>
                <HpName label={label} faction={faction} />
                <HpTrack
                    label={label}
                    clamped={clamped}
                    max={max}
                    percent={percent}
                    className="min-w-10 flex-1"
                    hitNonce={hitNonce}
                />
                <HpCaption clamped={clamped} max={max} />
            </div>
        );
    }

    return (
        <div className={clsx('flex flex-col gap-[5px]', className)}>
            <div className="flex items-center justify-between gap-1.5">
                <HpName label={label} faction={faction} />
                <HpCaption clamped={clamped} max={max} />
            </div>
            <HpTrack
                label={label}
                clamped={clamped}
                max={max}
                percent={percent}
                hitNonce={hitNonce}
            />
        </div>
    );
}
