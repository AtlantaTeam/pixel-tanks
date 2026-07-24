import { clsx } from 'clsx';
import type { TIconName } from '../icon';
import { Icon } from '../icon';

export type TWeaponSelectorWeapon = {
    name: string;
    icon: TIconName;
    ammo: number;
};

type TWeaponSelectorProps = {
    weapons: TWeaponSelectorWeapon[];
    selectedIndex: number;
    onPrev: () => void;
    onNext: () => void;
    className?: string;
};

const ARROW_BUTTON_CLASSES =
    'flex min-h-11 w-12 shrink-0 cursor-pointer items-center justify-center border-[length:var(--border-w)] border-border-strong bg-surface text-text transition-colors hover:border-[color:var(--accent)] focus-visible:outline-none focus-visible:border-[color:var(--accent)]';

/** design-inventory.dc.html §HUD «Weapon Selector»: центральная панель на --accent/--glow
 *  с текущим оружием, стрелки листают список. Управляется снаружи (selectedIndex +
 *  onPrev/onNext) — компонент не решает, кольцевой ли обход списка.
 *
 *  Контракт: вызывающий код обязан держать `selectedIndex` в границах `weapons`.
 *  При выходе за границы (или пустом `weapons`) центральная панель рендерится
 *  пустой — это безопасный, но «тихий» фолбэк без диагностики, а не штатный режим. */
export function WeaponSelector({
    weapons,
    selectedIndex,
    onPrev,
    onNext,
    className,
}: TWeaponSelectorProps) {
    const weapon = weapons[selectedIndex];

    return (
        <div className={clsx('flex items-stretch gap-0.5', className)}>
            <button
                type="button"
                onClick={onPrev}
                aria-label="Предыдущее оружие"
                className={ARROW_BUTTON_CLASSES}
            >
                <Icon name="arrow-l" />
            </button>
            <div className="flex flex-1 items-center justify-center gap-3 border-[length:var(--border-w)] border-[color:var(--accent)] bg-surface px-4 py-3 shadow-[var(--glow)]">
                {weapon && (
                    <>
                        <Icon name={weapon.icon} size={22} className="text-[color:var(--accent)]" />
                        <div className="flex flex-col items-center gap-0.5 text-center">
                            <span className="font-ui text-[15px] font-bold text-text">
                                {weapon.name}
                            </span>
                            <span className="font-ui text-label tracking-[0.1em] text-text-muted uppercase">
                                ×{weapon.ammo}
                            </span>
                        </div>
                    </>
                )}
            </div>
            <button
                type="button"
                onClick={onNext}
                aria-label="Следующее оружие"
                className={ARROW_BUTTON_CLASSES}
            >
                <Icon name="arrow-r" />
            </button>
        </div>
    );
}
