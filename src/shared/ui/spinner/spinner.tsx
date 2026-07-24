import { clsx } from 'clsx';

type TSpinnerProps = {
    size?: number;
    label?: string;
    className?: string;
};

/** design-inventory.dc.html §09 (спиннер в loading-кнопке): круг с прозрачным
 *  верхним краем на `animate-spin`. `currentColor` — цвет задаётся текстовым
 *  токеном вызывающего кода (`className="text-accent"` и т.п.), как у Icon. */
export function Spinner({ size = 20, label = 'Загрузка', className }: TSpinnerProps) {
    return (
        <span role="status" className={clsx('inline-flex items-center justify-center', className)}>
            <span
                aria-hidden="true"
                style={{ width: size, height: size }}
                className="animate-spin rounded-full border-[3px] border-current border-t-transparent motion-reduce:animate-none"
            />
            <span className="sr-only">{label}</span>
        </span>
    );
}
