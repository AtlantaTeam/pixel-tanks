/**
 * Оси темизации из token-spec.md §3. Тема — это набор data-атрибутов на предке,
 * под которыми globals.css переопределяет семантические --accent/--accent-ink/
 * --glow. Компоненты (Button/Dialog) читают семантику и меняются без правок.
 */

/** Фракция: чей акцент (зелёный игрок / магента-враг). Ось «кто ходит / где ты». */
export type TFaction = 'player' | 'enemy';

/** Исход боя — накидывается поверх фракции на game-over (зелёный / красный). */
export type TOutcome = 'victory' | 'defeat';

/** Интенсивность: `calm` глушит glow для долгих сессий, сохраняя цвета. */
export type TIntensity = 'normal' | 'calm';
