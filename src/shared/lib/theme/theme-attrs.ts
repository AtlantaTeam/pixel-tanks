import type { TFaction, TIntensity, TOutcome } from './t-theme';

export type TThemeAttrsInput = {
    faction?: TFaction;
    outcome?: TOutcome;
    intensity?: TIntensity;
};

/**
 * Собирает data-атрибуты темы для DOM-элемента. Тема переключается ими на предке —
 * globals.css переопределяет под ними --accent/--glow, компоненты меняются без
 * правок (token-spec.md §3). Пустые оси и `intensity: 'normal'` не пишем, чтобы
 * не плодить атрибуты и не переопределять :root без нужды (нет атрибута = дефолт).
 */
export function themeAttrs({ faction, outcome, intensity }: TThemeAttrsInput = {}): Record<
    string,
    string
> {
    const attrs: Record<string, string> = {};

    if (faction) attrs['data-faction'] = faction;
    if (outcome) attrs['data-outcome'] = outcome;
    if (intensity && intensity !== 'normal') attrs['data-intensity'] = intensity;

    return attrs;
}
