import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Кастомные размеры шрифта из `@theme` (`globals.css`, секция `--text-*`).
 *
 * Список продублирован здесь намеренно: `tailwind-merge` не читает наш CSS и
 * знает только стоковую шкалу (`text-xs`…`text-9xl`). Всё, чего в ней нет, он
 * относит к ЦВЕТУ текста — и `twMerge('text-text text-xs', 'text-hud')` вернул
 * бы `'text-xs text-hud'`: цвет варианта молча выброшен, размер оставлен, ровно
 * наоборот задуманному (ревью #554). Синхронность списка с `@theme` сторожит
 * тест `tw-merge.test.ts` — ради него список и экспортируется; в публичный API
 * слайса (`index.ts`) он намеренно не выведен.
 */
export const THEME_FONT_SIZES = [
    'display',
    'h1',
    'h2',
    'hud-xl',
    'hud',
    'button',
    'body',
    'caption',
    'label',
] as const;

/**
 * `twMerge`, знающий токены нашей темы. Использовать вместо голого `twMerge`
 * из пакета — иначе классы вида `text-hud` считаются цветом текста (см. выше).
 *
 * Расширяем только группу `font-size`: остальные кастомные токены темы
 * (`--color-*`, `--glow-*`, `--edge-*`) приходят в разметку либо стоковыми
 * именами утилит (`bg-primary`, `text-text-muted` — их tailwind-merge уже
 * разбирает как цвет), либо произвольными значениями (`shadow-[var(--glow)]`),
 * где группа определяется по самой утилите.
 */
export const twMerge = extendTailwindMerge({
    extend: {
        classGroups: {
            'font-size': THEME_FONT_SIZES.map((name) => `text-${name}`),
        },
    },
});
