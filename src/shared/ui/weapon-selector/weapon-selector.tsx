import { clsx } from 'clsx';
import type { TIconName } from '../icon';
import { Icon } from '../icon';

export type TWeaponSelectorWeapon = {
    name: string;
    icon: TIconName;
    ammo: number;
};

export type TWeaponSelectorSize = 'default' | 'compact';

type TWeaponSelectorProps = {
    weapons: TWeaponSelectorWeapon[];
    selectedIndex: number;
    onPrev: () => void;
    onNext: () => void;
    className?: string;
    /** Компактная палуба мобилки (issue #451): стрелки и панель — 44px, ровно
     *  минимальная тач-цель (доп. псевдоэлемент не нужен — визуальный бокс
     *  сам покрывает 44×44), имя и боезапас в один ряд вместо двух. Планшет/
     *  десктоп остаются `default` (48px, #450) — их issue #451 не трогает. */
    size?: TWeaponSelectorSize;
};

const ARROW_BUTTON_BASE =
    'flex shrink-0 cursor-pointer items-center justify-center border-[length:var(--border-w)] border-border-strong bg-surface text-text transition-colors hover:border-[color:var(--accent)] focus-visible:outline-none focus-visible:border-[color:var(--accent)]';

/** design-inventory.dc.html §HUD «Weapon Selector»: центральная панель на --accent/--glow
 *  с текущим оружием, стрелки листают список. Управляется снаружи (selectedIndex +
 *  onPrev/onNext) — компонент не решает, кольцевой ли обход списка.
 *
 *  Контракт: вызывающий код обязан держать `selectedIndex` в границах `weapons`.
 *  При выходе за границы (или пустом `weapons`) центральная панель рендерится
 *  пустой и приглушённой (муто-рамка, как штатное «×0»), а не активным
 *  accent-слотом — это безопасный, но «тихий» фолбэк без диагностики, а не
 *  штатный режим. Высоту панели фолбэк держит невидимым размерником (чтобы палуба
 *  не «скакала», когда у игрока кончаются снаряды и `game-controls` отдаёт пустой
 *  список). */
export function WeaponSelector({
    weapons,
    selectedIndex,
    onPrev,
    onNext,
    className,
    size = 'default',
}: TWeaponSelectorProps) {
    const weapon = weapons[selectedIndex];
    // «Пусто» (handoff «Селектор оружия»): сигнал «стрелять нечем», не просто
    // низкий боезапас, поэтому контур глушится (муто-рамка без --accent/--glow),
    // а не рисуется как активный слот. Два пути к этому состоянию:
    //   • слот с `ammo === 0` — штатное «×0» (витрина `/design-system`, тесты);
    //   • пустой список / выход за границы — «тихий фолбэк»: в живой игре при нуле
    //     снарядов `game-controls` отдаёт пустой список (стор обнуляет
    //     `selectedWeapon`), поэтому `weapon` тут `undefined`.
    // Оба красятся одинаково приглушённо: пустая панель НЕ должна светиться
    // accent'ом как заряженный слот. Сигнал «нечем стрелять» дополнительно несёт
    // дизейбл кнопки «ОГОНЬ» в `game-controls`.
    const isEmpty = weapon == null || weapon.ammo === 0;
    const compact = size === 'compact';

    return (
        <div className={clsx('flex items-stretch gap-0.5', className)}>
            <button
                type="button"
                onClick={onPrev}
                aria-label="Предыдущее оружие"
                className={clsx(ARROW_BUTTON_BASE, compact ? 'size-11' : 'size-12')}
            >
                <Icon name="arrow-l" />
            </button>
            <div
                data-testid="weapon-ammo"
                data-ammo-count={weapon?.ammo ?? 0}
                className={clsx(
                    'flex flex-1 items-center justify-center border-[length:var(--border-w)] bg-surface',
                    compact ? 'h-11 gap-1.5 px-2' : 'gap-3 px-3.5 py-1.5',
                    isEmpty
                        ? 'border-border-strong opacity-55'
                        : 'border-[color:var(--accent)] shadow-[var(--glow)]',
                )}
            >
                {weapon ? (
                    <>
                        <Icon
                            name={weapon.icon}
                            size={compact ? 16 : 22}
                            className={isEmpty ? 'text-text-dim' : 'text-[color:var(--accent)]'}
                        />
                        {compact ? (
                            // Компакт: имя + боезапас в один ряд по базовой линии —
                            // укладывается в фикс-высоту 44px без второй строки.
                            <span className="flex items-baseline gap-1.5">
                                <span className="font-ui text-[11px] font-bold text-text">
                                    {weapon.name}
                                </span>
                                <span
                                    className={clsx(
                                        'font-ui text-[9px] tracking-[0.1em] uppercase',
                                        isEmpty ? 'text-danger' : 'text-text-muted',
                                    )}
                                >
                                    ×{weapon.ammo}
                                </span>
                            </span>
                        ) : (
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
                        )}
                    </>
                ) : (
                    // Пустой список / выход за границы — «тихий фолбэк» (см. докблок).
                    // Держим высоту/ширину центральной панели невидимым размерником тем
                    // же приёмом, что `FixedNumeric`/пилюля хода в `top-hud`: без него
                    // палуба «скачет», когда у игрока кончаются снаряды и
                    // `game-controls` отдаёт пустой список (`weaponSlots = []`). Пусто
                    // остаётся пустым визуально — размерник невидим и вне дерева
                    // доступности.
                    <span
                        aria-hidden
                        className={clsx(
                            'invisible',
                            compact
                                ? 'flex items-baseline gap-1.5'
                                : 'flex flex-col items-center gap-0.5 text-center',
                        )}
                    >
                        <span
                            className={clsx(
                                'font-ui font-bold',
                                compact ? 'text-[11px]' : 'text-[15px]',
                            )}
                        >
                            Оружие
                        </span>
                        <span
                            className={clsx(
                                'font-ui tracking-[0.1em] uppercase',
                                compact ? 'text-[9px]' : 'text-label',
                            )}
                        >
                            ×0
                        </span>
                    </span>
                )}
            </div>
            <button
                type="button"
                onClick={onNext}
                aria-label="Следующее оружие"
                className={clsx(ARROW_BUTTON_BASE, compact ? 'size-11' : 'size-12')}
            >
                <Icon name="arrow-r" />
            </button>
        </div>
    );
}
