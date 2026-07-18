export type TKeyboardIntent =
    | 'angle-left'
    | 'angle-right'
    | 'power-up'
    | 'power-down'
    | 'move-left'
    | 'move-right'
    | 'weapon-prev'
    | 'weapon-next'
    | 'fire';

/**
 * Клавиатурная схема боя: стрелки — точная настройка угла/мощности,
 * Ctrl+стрелки — смена оружия / перемещение танка, Enter/Space — выстрел.
 */
export function resolveKeyboardIntent(key: string, ctrlKey: boolean): TKeyboardIntent | null {
    switch (key) {
        case 'ArrowLeft':
            return ctrlKey ? 'move-left' : 'angle-left';
        case 'ArrowRight':
            return ctrlKey ? 'move-right' : 'angle-right';
        case 'ArrowUp':
            return ctrlKey ? 'weapon-prev' : 'power-up';
        case 'ArrowDown':
            return ctrlKey ? 'weapon-next' : 'power-down';
        case ' ':
        case 'Enter':
            return 'fire';
        default:
            return null;
    }
}
