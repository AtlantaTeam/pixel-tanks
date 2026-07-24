import type { HTMLAttributes } from 'react';
import { themeAttrs, type TThemeAttrsInput } from './theme-attrs';

type TThemeScopeProps = HTMLAttributes<HTMLDivElement> & TThemeAttrsInput;

/**
 * Оборачивает поддерево в scope темы: проставляет data-faction/-outcome/-intensity,
 * под которыми globals.css переопределяет --accent/--accent-ink/--glow. Так тема
 * переключается на предке, а сами компоненты (Button variant="accent", Dialog)
 * читают семантику и не правятся (token-spec.md §3). Серверный компонент — просто
 * рендер атрибутов, без клиентского JS.
 */
export function ThemeScope({ faction, outcome, intensity, children, ...rest }: TThemeScopeProps) {
    return (
        <div {...themeAttrs({ faction, outcome, intensity })} {...rest}>
            {children}
        </div>
    );
}
