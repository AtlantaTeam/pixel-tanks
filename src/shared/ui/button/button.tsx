import type { ButtonHTMLAttributes } from 'react';
import { twMerge } from 'tailwind-merge';

export type TButtonVariant = 'primary' | 'accent' | 'ghost' | 'danger' | 'outline';
export type TButtonSize = 'sm' | 'md' | 'icon';

/** `accent` читает --accent/--accent-ink/--glow — переключается атрибутом
 *  [data-faction] на предке (docs/design-system-theming/token-spec.md, §3), без
 *  правки самого компонента.
 *
 *  primary/accent без рамки: объём и свечение — box-shadow из токенов
 *  (`--edge-pixel`/`--glow-*`), как в design-inventory.dc.html. `danger` — плоский
 *  outline (транспарентный фон + рамка/текст `--color-danger`), тот же паттерн,
 *  что и retry-кнопка в инвентаре.
 *
 *  `box-shadow` — одно свойство, поэтому фокус-ринг задаём ПОВАРИАНТНО, а не
 *  одним общим классом: у primary/accent объём — тоже `box-shadow`
 *  (`--edge-pixel`), и голый `focus-visible:shadow-[--ring-focus]` перебил бы
 *  edge (у `:focus-visible` выше специфичность), съев 3D-грань под клавиатурным
 *  фокусом. Домешиваем edge в фокус-тень (`edge,ring`); у ghost/danger/outline
 *  грани нет (рамка через `border`) — им достаточно кольца.
 *
 *  `outline` — контурный акцент (handoff game-over «Поделиться реплеем»): рамка +
 *  текст `var(--accent)`, без заливки. Отличается от `danger` только тем, что
 *  красится тематизированным `--accent` (переключается фракцией/исходом боя), а
 *  не фиксированным `--color-danger`; от `accent` — отсутствием заливки. */
const VARIANT_CLASSES: Record<TButtonVariant, string> = {
    primary:
        'bg-primary text-primary-ink shadow-[var(--edge-pixel)] hover:shadow-[var(--edge-pixel),var(--glow-primary)] focus-visible:shadow-[var(--edge-pixel),var(--ring-focus)]',
    accent: 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-[var(--edge-pixel)] hover:shadow-[var(--edge-pixel),var(--glow)] focus-visible:shadow-[var(--edge-pixel),var(--ring-focus)]',
    ghost: 'border-[length:var(--border-w)] border-border-strong bg-transparent text-text hover:border-[var(--accent)] focus-visible:shadow-[var(--ring-focus)]',
    danger: 'border-[length:var(--border-w)] border-danger bg-transparent text-danger focus-visible:shadow-[var(--ring-focus)]',
    outline:
        'border-[length:var(--border-w)] border-[var(--accent)] bg-transparent text-[var(--accent)] hover:shadow-[var(--glow)] focus-visible:shadow-[var(--ring-focus)]',
};

const SIZE_CLASSES: Record<TButtonSize, string> = {
    sm: 'min-h-11 px-3 py-2 text-[10px]',
    md: 'min-h-11 px-5 py-3 text-xs',
    icon: 'size-11 text-[10px]',
};

/** `disabled` — токены token-spec.md §5 (`bg-muted`/`text-text-dim`, без glow),
 *  а не opacity-затемнение: перекрывает цвет варианта у всех кнопок разом. */
const DISABLED_CLASSES =
    'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted disabled:text-text-dim disabled:shadow-none';

/** Классы кнопки отдельно от компонента — для Link и других не-button элементов.
 *
 *  Склейка — `tailwind-merge`, а НЕ `clsx` (#554). `clsx` конкатенирует строки, и
 *  при равной специфичности исход решает порядок в СГЕНЕРИРОВАННОМ Tailwind-стиле,
 *  а не порядок в атрибуте `class`. Поэтому `className="m-0"` не перебивал базовый
 *  `m-1`: у 13 кнопок (звук/пауза в HUD, кадры витрины) оставался живой
 *  `margin: 4px`, ломавший ритм рядов. `twMerge` выкидывает конфликтующий класс
 *  из самой строки — побеждает тот, что пришёл от вызывающего, независимо от
 *  каскада. Обходной `!m-0` (#538) после этого не нужен: important лечил симптом,
 *  и tailwind-merge его всё равно не сливает (классы с разным набором
 *  модификаторов он считает неконфликтующими).
 *
 *  Базовый `m-1` при этом остаётся: кнопка без `className` ведёт себя как раньше,
 *  а не теряет отступ (иначе правка расползлась бы на все экраны разом). */
export function buttonClasses(
    variant: TButtonVariant = 'primary',
    size: TButtonSize = 'md',
    className?: string,
) {
    return twMerge(
        'm-1 inline-flex cursor-pointer items-center justify-center font-ui tracking-[0.06em] uppercase',
        'transition-[filter] active:translate-y-0.5',
        // Видимый фокус — поварианто в VARIANT_CLASSES (edge+ring там, где есть
        // грань), тут только гасим нативный outline.
        'focus-visible:outline-none',
        DISABLED_CLASSES,
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
    );
}

type TButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: TButtonVariant;
    size?: TButtonSize;
};

export function Button({ variant = 'primary', size = 'md', className, ...props }: TButtonProps) {
    return <button type="button" className={buttonClasses(variant, size, className)} {...props} />;
}
