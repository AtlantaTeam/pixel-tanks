import { clsx } from 'clsx';

type TKeyboardSchemeHintProps = {
    className?: string;
};

/**
 * Клавиатурная подсказка нижней полосы (handoff «Клавиатурная подсказка»): реальная
 * схема ввода (`resolveKeyboardIntent`), не приблизительное описание. Видима только на
 * десктопе/широком — гейт `pointer:fine`+`hover:hover` держит её невидимой на
 * тач-устройствах (там кнопка ОГОНЬ/манёвр под пальцем, а не под клавиатурой), CSS
 * решает сам, без JS-детекта устройства (не гадаем по ширине вьюпорта).
 */
export function KeyboardSchemeHint({ className }: TKeyboardSchemeHintProps = {}) {
    return (
        <div
            className={clsx(
                'hidden items-center gap-3.5 font-ui text-[10px] text-text-dim [@media(hover:hover)_and_(pointer:fine)]:flex',
                className,
            )}
        >
            <span>← → угол</span>
            <span>↑ ↓ сила</span>
            <span>Ctrl + ← → манёвр</span>
            <span>Space выстрел</span>
        </div>
    );
}
