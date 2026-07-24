'use client';

import { useRef, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';

export type TSegmentedControlOption<TValue extends string> = {
    value: TValue;
    label: string;
};

type TSegmentedControlProps<TValue extends string> = {
    options: TSegmentedControlOption<TValue>[];
    value: TValue;
    onChange: (value: TValue) => void;
    /** Доступное имя группы (aria-label) — видимую подпись рисует вызывающий код рядом,
     *  как в design-inventory.dc.html §08 («Язык», «Сложность» отдельным заголовком). */
    label: string;
    className?: string;
};

/** design-inventory.dc.html §08 «Segmented Control»: взаимоисключающий выбор
 *  (период лидерборда, сложность, язык, скорость плеера реплея) — активный сегмент
 *  на --accent/--accent-ink/--glow. Ведёт себя как radiogroup (roving tabindex,
 *  стрелки вправо/влево), а не tablist — сегменты не переключают панели контента. */
export function SegmentedControl<TValue extends string>({
    options,
    value,
    onChange,
    label,
    className,
}: TSegmentedControlProps<TValue>) {
    const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
    // Если value не совпал ни с одной опцией (пустое начальное значение при непустом
    // списке), по ARIA-паттерну radio tabbable должен остаться первый сегмент — иначе
    // roving tabindex выкинет всю группу из Tab-обхода.
    const hasActiveOption = options.some((option) => option.value === value);

    const selectByIndex = (index: number) => {
        const option = options[index];
        if (!option) return;
        onChange(option.value);
        buttonRefs.current[index]?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            selectByIndex((index + 1) % options.length);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            selectByIndex((index - 1 + options.length) % options.length);
        }
    };

    return (
        <div
            role="radiogroup"
            aria-label={label}
            className={clsx(
                'inline-flex gap-0.5 border-[length:var(--border-w)] border-border bg-surface p-[3px]',
                className,
            )}
        >
            {options.map((option, index) => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        ref={(node) => {
                            buttonRefs.current[index] = node;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        tabIndex={active || (!hasActiveOption && index === 0) ? 0 : -1}
                        onClick={() => onChange(option.value)}
                        onKeyDown={(event) => handleKeyDown(event, index)}
                        className={clsx(
                            'min-h-11 cursor-pointer px-4 py-2 font-ui text-caption font-bold tracking-[0.06em] uppercase transition-colors',
                            'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
                            active
                                ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-[var(--glow)]'
                                : 'bg-transparent text-text-muted',
                        )}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
