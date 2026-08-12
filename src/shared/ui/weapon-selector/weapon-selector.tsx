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

// 48×48 (handoff «Селектор оружия») — совпадает с size-12 дефолтной Tailwind-шкалы.
const ARROW_BUTTON_CLASSES =
    'flex size-12 shrink-0 cursor-pointer items-center justify-center border-[length:var(--border-w)] border-border-strong bg-surface text-text transition-colors hover:border-[color:var(--accent)] focus-visible:outline-none focus-visible:border-[color:var(--accent)]';

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
    // «Пусто» (handoff «Селектор оружия»): ×0 — сигнал «стрелять нечем», не просто
    // низкий боезапас, поэтому цвет и контур меняются, а не просто гаснут.
    const isEmpty = weapon != null && weapon.ammo === 0;

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
            <div
                data-testid="weapon-ammo"
                data-ammo-count={weapon?.ammo ?? 0}
                className={clsx(
                    'flex flex-1 items-center justify-center gap-3 border-[length:var(--border-w)] bg-surface px-3.5 py-1.5',
                    isEmpty
                        ? 'border-border-strong opacity-55'
                        : 'border-[color:var(--accent)] shadow-[var(--glow)]',
                )}
            >
                {weapon && (
                    <>
                        <Icon
                            name={weapon.icon}
                            size={22}
                            className={isEmpty ? 'text-text-dim' : 'text-[color:var(--accent)]'}
                        />
                        <div className="flex flex-col items-center gap-0.5 text-center">
                            <span className="font-ui text-[15px] font-bold text-text">
                                {weapon.name}
                            </span>
                            <span
                                className={clsx(
                                    'font-ui text-label tracking-[0.1em] uppercase',
                                    isEmpty ? 'text-danger' : 'text-text-muted',
                                )}
                            >
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
