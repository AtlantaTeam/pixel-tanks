'use client';

import type { KeyboardEvent, OptionHTMLAttributes, ReactNode } from 'react';
import { Children, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Icon } from '../icon';

type TSelectOption = {
    value: string;
    label: string;
    disabled: boolean;
};

/** `<option>{a} #{b}</option>` (game-controls) — несколько children, не одна строка;
 *  собираем видимый текст так же, как браузер считает `textContent` нативного `<option>`. */
function nodeToText(node: ReactNode): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(nodeToText).join('');
    if (isValidElement<{ children?: ReactNode }>(node)) return nodeToText(node.props.children);
    return '';
}

/** `children` — те же `<option>`, что и у нативного `<select>` (совместимость вызовов
 *  game-controls/витрины без переписывания): парсим их в модель попапа, а не рендерим. */
function readOptions(children: ReactNode): TSelectOption[] {
    const options: TSelectOption[] = [];

    Children.forEach(children, (child) => {
        if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child)) return;
        const { value, children: content, disabled } = child.props;
        options.push({
            value: String(value ?? ''),
            label: nodeToText(content) || String(value ?? ''),
            disabled: Boolean(disabled),
        });
    });

    return options;
}

type TSelectProps = {
    id?: string;
    label?: string;
    value?: string | number;
    defaultValue?: string | number;
    /** Не DOM-событие, а честная сигнатура «выбрано значение» — попап не эмитит нативный
     *  `ChangeEvent` (нет `currentTarget` и прочих полей), поэтому имя без `on…Change`-обмана. */
    onValueChange?: (value: string) => void;
    disabled?: boolean;
    className?: string;
    /** Текст в триггере, когда значение пустое/несматченное (нет выбранной опции) —
     *  у кастомного попапа нет нативного фолбэка `<select>` на первую опцию. */
    placeholder?: string;
    children: ReactNode;
    /** Открыть попап сразу при монтировании — статичный срез «открытого» состояния
     *  для витрины `/design-system` (design-system-showcase.md), как `Dialog`
     *  variant="static". Обычные вызовы (game-controls) это не передают. */
    defaultOpen?: boolean;
};

/** Кастомный тематический дропдаун (design-inventory.dc.html §03) — попап-паттерн
 *  APG "Collapsible Dropdown Listbox": триггер-кнопка (`aria-haspopup="listbox"`,
 *  `aria-expanded`) открывает `role="listbox"`, фокус уходит в него, активный пункт —
 *  через `aria-activedescendant`, а не реальный DOM-фокус на `<li>`. Никакого нативного
 *  `<select>` для открытого состояния — попап целиком на токенах темы. */
export function Select({
    id,
    label,
    value,
    defaultValue,
    onValueChange,
    disabled = false,
    className,
    placeholder,
    children,
    defaultOpen = false,
}: TSelectProps) {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const labelId = `${selectId}-label`;
    const listboxId = `${selectId}-listbox`;

    const options = readOptions(children);
    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(() =>
        String(defaultValue ?? options.find((o) => !o.disabled)?.value ?? ''),
    );
    const selectedValue = String((isControlled ? value : internalValue) ?? '');
    const selectedIndex = options.findIndex((o) => o.value === selectedValue);
    const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

    const [open, setOpen] = useState(defaultOpen);
    const [activeIndex, setActiveIndex] = useState(() => (selectedIndex >= 0 ? selectedIndex : 0));
    // defaultOpen (витрина) не должен красть фокус страницы при монтировании —
    // пропускаем ровно один авто-фокус, сразу за ним идут уже обычные открытия.
    const skipInitialFocusRef = useRef(defaultOpen);

    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listboxRef = useRef<HTMLUListElement>(null);
    const typeaheadRef = useRef('');
    const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const commit = (nextValue: string) => {
        if (!isControlled) setInternalValue(nextValue);
        onValueChange?.(nextValue);
    };

    const openListbox = () => {
        if (disabled || options.length === 0) return;
        const firstEnabled = options.findIndex((o) => !o.disabled);
        // Все опции disabled и ничего не выбрано — открывать нечего (нет пункта, на
        // который можно встать активным). Нативный `<select>` в этом кейсе тоже не даёт выбор.
        if (selectedIndex < 0 && firstEnabled < 0) return;
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled);
        setOpen(true);
    };

    const closeListbox = (returnFocus: boolean) => {
        setOpen(false);
        if (returnFocus) triggerRef.current?.focus();
    };

    const selectActive = () => {
        const option = options[activeIndex];
        if (!option || option.disabled) return;
        commit(option.value);
        closeListbox(true);
    };

    const stepActive = (delta: 1 | -1) => {
        if (options.length === 0) return;
        let index = activeIndex;
        for (let step = 0; step < options.length; step++) {
            index = (index + delta + options.length) % options.length;
            if (!options[index].disabled) break;
        }
        setActiveIndex(index);
    };

    const goHome = () => {
        const index = options.findIndex((o) => !o.disabled);
        if (index >= 0) setActiveIndex(index);
    };

    const goEnd = () => {
        for (let index = options.length - 1; index >= 0; index--) {
            if (!options[index].disabled) {
                setActiveIndex(index);
                return;
            }
        }
    };

    const onTypeahead = (key: string) => {
        if (options.length === 0) return;
        if (key.length !== 1 || !/[a-zа-яё0-9]/i.test(key)) return;
        clearTimeout(typeaheadTimerRef.current);
        typeaheadRef.current += key.toLowerCase();
        const query = typeaheadRef.current;
        typeaheadTimerRef.current = setTimeout(() => {
            typeaheadRef.current = '';
        }, 500);

        const startFrom = (activeIndex + 1) % options.length;
        for (let step = 0; step < options.length; step++) {
            const index = (startFrom + step) % options.length;
            const option = options[index];
            if (!option.disabled && option.label.toLowerCase().startsWith(query)) {
                setActiveIndex(index);
                return;
            }
        }
    };

    useEffect(() => {
        if (!open) return;
        if (skipInitialFocusRef.current) {
            skipInitialFocusRef.current = false;
            return;
        }
        listboxRef.current?.focus();
    }, [open]);

    // Клик мимо триггера и попапа закрывает список без выбора — фокус не перехватываем,
    // он уже там, куда кликнул пользователь.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) closeListbox(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [open]);

    const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
        if (disabled || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openListbox();
        }
    };

    const onListboxKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                stepActive(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                stepActive(-1);
                break;
            case 'Home':
                e.preventDefault();
                goHome();
                break;
            case 'End':
                e.preventDefault();
                goEnd();
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                selectActive();
                break;
            case 'Escape':
                e.preventDefault();
                closeListbox(true);
                break;
            case 'Tab':
                // Вернуть фокус на триггер, а не бросать его на исчезающем `<ul>`:
                // Tab тогда детерминированно уходит с триггера на следующий элемент.
                closeListbox(true);
                break;
            default:
                onTypeahead(e.key);
        }
    };

    return (
        <div ref={rootRef} className="relative flex flex-col items-center gap-1">
            {label && (
                <span id={labelId} className="text-xs text-text-muted">
                    {label}
                </span>
            )}
            <button
                ref={triggerRef}
                id={selectId}
                type="button"
                disabled={disabled}
                // Число опций как атрибут триггера — попап рендерит `<li role="option">`
                // лишь в открытом состоянии, а нативных `<option>` больше нет. Атрибут
                // отражает состав селекта всегда (открыт он или нет) — за него цепляются
                // e2e бои, считая оставшееся у игрока оружие, не раскрывая список.
                data-option-count={options.length}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listboxId}
                // APG select-only combobox: имя триггера = подпись + текущее значение.
                // Кнопка ссылается сама на себя (`selectId`), чтобы её текст-значение попал
                // в accessible name (иначе SR объявит только подпись, теряя выбор — регрессия).
                aria-labelledby={[label ? labelId : null, selectId].filter(Boolean).join(' ')}
                onClick={() => (open ? closeListbox(false) : openListbox())}
                onKeyDown={onTriggerKeyDown}
                className={clsx(
                    'm-1 flex min-h-11 w-full cursor-pointer items-center justify-between gap-2',
                    'border-[length:var(--border-w)] border-border-strong bg-surface px-2 py-1.5',
                    'font-ui text-[10px] text-text',
                    'focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)]',
                    'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted disabled:text-text-dim',
                    className,
                )}
            >
                <span className={clsx('truncate', !selectedOption && 'text-text-dim')}>
                    {selectedOption?.label ?? placeholder ?? ''}
                </span>
                <Icon
                    name="arrow-d"
                    size={12}
                    className={clsx('shrink-0 transition-transform', open && 'rotate-180')}
                />
            </button>
            {open && (
                <ul
                    ref={listboxRef}
                    id={listboxId}
                    role="listbox"
                    tabIndex={-1}
                    aria-labelledby={label ? labelId : undefined}
                    aria-activedescendant={
                        options[activeIndex] ? `${selectId}-option-${activeIndex}` : undefined
                    }
                    onKeyDown={onListboxKeyDown}
                    className="absolute top-full z-10 mt-1 max-h-60 w-full overflow-auto border-[length:var(--border-w)] border-border-strong bg-panel py-1 shadow-[var(--shadow-drop)] focus-visible:outline-none"
                >
                    {options.map((option, index) => (
                        <li
                            key={option.value}
                            id={`${selectId}-option-${index}`}
                            role="option"
                            aria-selected={option.value === selectedValue}
                            aria-disabled={option.disabled || undefined}
                            onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                            onClick={() => {
                                if (option.disabled) return;
                                commit(option.value);
                                closeListbox(true);
                            }}
                            className={clsx(
                                'px-2 py-1.5 font-ui text-[10px]',
                                option.disabled
                                    ? 'cursor-not-allowed text-text-dim'
                                    : clsx(
                                          'cursor-pointer',
                                          index === activeIndex
                                              ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                                              : option.value === selectedValue
                                                ? 'text-[var(--accent)]'
                                                : 'text-text',
                                      ),
                            )}
                        >
                            {option.label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
