'use client';

import { clsx } from 'clsx';
import type { RefObject } from 'react';
import {
    formatAngle,
    selectShowGestureHint,
    useArenaInset,
    useGameStore,
    type TGameCanvasHandle,
} from '@/features/game-engine';
import { Icon, WeaponSelector, type TIconName, type TWeaponSelectorWeapon } from '@/shared/ui';
import { EWeaponKind, type TWeapon } from '@/shared/model';
import { KeyboardSchemeHint } from './keyboard-scheme-hint';

/** Контраст над любым скином (handoff, решение E) — та же строка, что в `top-hud`:
 *  подложка + blur держат читаемость текстовой подсказки поверх шумной/светлой арены. */
const HUD_SURFACE = 'bg-[rgba(8,12,8,0.80)] backdrop-blur-[4px] shadow-[0_0_0_1px_rgba(0,0,0,.9)]';

/** GDD §9-E: тип оружия → иконка. Связь по `kind`-enum, а не по строке имени
 *  (issue #483): движок раздаёт четыре типа, и иконки больше не падают в fallback.
 *  Нейтральный `fire` остаётся страховкой на неизвестный тип. */
const WEAPON_ICONS: Record<EWeaponKind, TIconName> = {
    [EWeaponKind.HighExplosive]: 'wpn-фугас',
    [EWeaponKind.Heavy]: 'wpn-мощный',
    [EWeaponKind.Cluster]: 'wpn-кластер',
    [EWeaponKind.Digger]: 'wpn-роющий',
};

function weaponIcon(kind: EWeaponKind): TIconName {
    return WEAPON_ICONS[kind] ?? 'fire';
}

type TGameControlsProps = {
    /** Манёвр и выстрел живут на инстансе движка внутри `GameCanvas` (см.
     *  `TGameCanvasHandle`), не в сторе — `views/game-page` создаёт общий ref и
     *  прокидывает его canvas'у и палубе. */
    gameApiRef: RefObject<TGameCanvasHandle | null>;
};

function ManeuverButton({
    direction,
    disabled,
    onClick,
    compact,
}: {
    direction: 'left' | 'right';
    disabled: boolean;
    onClick: () => void;
    /** Компактная палуба мобилки (#451): 44×44 — ровно минимальная тач-цель,
     *  визуальный бокс сам покрывает hit-area (доп. псевдоэлемент не нужен).
     *  Планшет/десктоп остаются 56×64 (handoff «Кнопки манёвра»). */
    compact?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={direction === 'left' ? 'Сдвинуть влево' : 'Сдвинуть вправо'}
            className={clsx(
                'flex shrink-0 cursor-pointer items-center justify-center border-[length:var(--border-w)] border-border-strong bg-panel-raised text-text transition-colors hover:border-[color:var(--accent)] focus-visible:outline-none focus-visible:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted disabled:text-text-dim',
                // compact: 44×44 (h-11 w-11) — минимальная тач-цель компактной палубы
                // (#451); иначе 56×64 (handoff «Кнопки манёвра») — w-14/h-16 дефолтной
                // Tailwind-шкалы.
                compact ? 'h-11 w-11' : 'h-16 w-14',
            )}
        >
            <Icon name={direction === 'left' ? 'arrow-l' : 'arrow-r'} />
        </button>
    );
}

function FireButton({
    disabled,
    hint,
    angle,
    power,
    onClick,
    compact,
    className,
}: {
    disabled: boolean;
    hint: 'touch' | 'desktop';
    angle: number;
    power: number;
    onClick: () => void;
    /** Компактная палуба мобилки (#451): min-height 44 вместо 64 — ОГОНЬ
     *  остаётся главной целью ряда шириной (`flex:1`) и цветом, не высотой. */
    compact?: boolean;
    className?: string;
}) {
    const angleDeg = formatAngle(angle);
    const subtitle = disabled
        ? 'нет снарядов'
        : hint === 'desktop'
          ? 'space'
          : `повторить ${angleDeg}° · ${String(power).padStart(3, '0')}`;

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={
                disabled ? 'Огонь — нет снарядов' : `Огонь: угол ${angleDeg}°, сила ${power}`
            }
            className={clsx(
                'flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 uppercase transition-[filter] active:translate-y-0.5 disabled:cursor-not-allowed',
                // flex:1, min-height:64px (handoff «Кнопка ОГОНЬ»); компакт — 44.
                compact ? 'min-h-11' : 'min-h-16',
                disabled
                    ? 'bg-muted text-text-dim shadow-none'
                    : 'bg-primary text-primary-ink shadow-[var(--edge-pixel),var(--glow-primary)]',
                className,
            )}
        >
            <span
                className={clsx(
                    'font-display tracking-[0.12em]',
                    compact ? 'text-[15px]' : 'text-[20px]',
                )}
            >
                Огонь
            </span>
            <span className="text-[9px] tracking-normal opacity-75">{subtitle}</span>
        </button>
    );
}

/** Подсказка жеста (issue #451): только мобильная палуба, компактный размер —
 *  не постоянная строка (см. `selectShowGestureHint`), поэтому не нужен вариант
 *  под другие брейкпоинты. */
function GestureHint({ className }: { className?: string }) {
    return (
        <p
            className={clsx(
                HUD_SURFACE,
                'border-[length:var(--border-w)] border-border px-2 py-1 text-center font-ui text-[9px] text-text-muted uppercase',
                className,
            )}
        >
            Тяни по арене — отпусти, чтобы выстрелить
        </p>
    );
}

/** Единый ключ смены выбранного оружия (стрелки селектора палубы): та же
 *  циклическая логика, что и `Ctrl+↑/↓` на клавиатуре (`resolveKeyboardIntent`) —
 *  два входа не должны разойтись в поведении. */
function stepWeapon(weapons: TWeapon[], current: TWeapon, direction: 1 | -1): TWeapon | null {
    const index = weapons.findIndex((w) => w.id === current.id);
    if (index < 0) return null;
    return weapons[(index + direction + weapons.length) % weapons.length];
}

/**
 * Нижняя палуба боевого экрана (handoff «Палуба»): селектор оружия, манёвр ‹ ›,
 * кнопка ОГОНЬ. Три раздельных состава по брейкпоинту — как `widgets/top-hud`:
 * мобилка (<768) колонкой, планшет (768–1279) угловыми кластерами, десктоп
 * (≥1280) единой полосой с клавиатурной подсказкой. Манёвр/выстрел дёргают
 * движок через `gameApiRef` (см. `TGameCanvasHandle`) — сам стор их не хранит.
 */
export function GameControls({ gameApiRef }: TGameControlsProps) {
    const weapons = useGameStore((s) => s.weapons);
    const selectedWeapon = useGameStore((s) => s.selectedWeapon);
    const selectWeapon = useGameStore((s) => s.selectWeapon);
    const moves = useGameStore((s) => s.moves);
    const angle = useGameStore((s) => s.angle);
    const power = useGameStore((s) => s.power);
    const turn = useGameStore((s) => s.turn);
    const phase = useGameStore((s) => s.phase);
    // Подсказка жеста живёт до первого выстрела ТЕКУЩЕГО боя (#451) — источник
    // в сторе (`shotsFired`), не локальный `useState`: иначе подсказка вернулась
    // бы после ремаунта `GameControls` посреди боя.
    const showGestureHint = useGameStore(selectShowGestureHint);

    // Публикуем фактическую высоту палубы в нижний инсет арены (контракт safe-зоны,
    // #453): высота меняется по брейкпоинтам и от подсказки жеста (#451) — движок
    // читает её из стора, а не хардкодит (см. `useArenaInset`).
    const insetRef = useArenaInset<HTMLDivElement>('bottom');

    // Ход соперника/снаряд в полёте — палуба не должна принимать ввод (движок сам
    // отбрасывает такие вызовы, но кнопки обязаны выглядеть недоступными).
    const isPlayerTurn = turn === 'player' && phase !== 'flight' && phase !== 'over';
    const canManeuver = isPlayerTurn && moves > 0;
    const canFire = isPlayerTurn && weapons.length > 0;

    const currentSlot: TWeaponSelectorWeapon | null = selectedWeapon
        ? {
              name: selectedWeapon.name,
              icon: weaponIcon(selectedWeapon.kind),
              ammo: weapons.filter((w) => w.kind === selectedWeapon.kind).length,
          }
        : null;
    const weaponSlots = currentSlot ? [currentSlot] : [];

    const cycleWeapon = (direction: 1 | -1) => {
        if (!isPlayerTurn || !selectedWeapon) return;
        const next = stepWeapon(weapons, selectedWeapon, direction);
        if (next) selectWeapon(next);
    };

    const fire = () => gameApiRef.current?.fire();
    const moveLeft = () => gameApiRef.current?.moveLeft();
    const moveRight = () => gameApiRef.current?.moveRight();

    return (
        <div
            ref={insetRef}
            data-testid="game-hud"
            // Всего снарядов у игрока (всех типов): стабильный монотонный сигнал для
            // e2e (issue #483) — селектор палубы показывает боезапас ВЫБРАННОГО типа,
            // который скачет при авто-переключении оружия после выстрела, а этот
            // счётчик убывает ровно на 1 за выстрел.
            data-weapons-remaining={weapons.length}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-6"
        >
            {/* Мобилка (<768): колонка — селектор, манёвр+ОГОНЬ, подсказка жеста
                (только до первого выстрела боя, #451). Бюджет ≤150px без
                подсказки / ≤175px с ней (390×844) — компактные размеры селектора
                и кнопок манёвра держат этот потолок, ОГОНЬ остаётся главной целью
                ряда шириной (`flex:1`) и цветом, а не высотой. */}
            <div
                data-testid="game-deck-mobile"
                className="pointer-events-auto flex flex-col gap-2 bg-linear-to-t from-[rgba(8,12,8,.92)] from-[26%] to-transparent px-2.5 pt-4 md:hidden"
                style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 8px))' }}
            >
                <WeaponSelector
                    weapons={weaponSlots}
                    selectedIndex={0}
                    onPrev={() => cycleWeapon(-1)}
                    onNext={() => cycleWeapon(1)}
                    size="compact"
                />
                <div className="flex items-stretch gap-2">
                    <ManeuverButton
                        direction="left"
                        disabled={!canManeuver}
                        onClick={moveLeft}
                        compact
                    />
                    <ManeuverButton
                        direction="right"
                        disabled={!canManeuver}
                        onClick={moveRight}
                        compact
                    />
                    <FireButton
                        disabled={!canFire}
                        hint="touch"
                        angle={angle}
                        power={power}
                        onClick={fire}
                        compact
                    />
                </div>
                {showGestureHint && <GestureHint />}
            </div>

            {/* Планшет (768–1279): угловые кластеры — селектор слева, манёвр+ОГОНЬ справа. */}
            <div
                data-testid="game-deck-tablet"
                className="pointer-events-auto hidden items-end justify-between gap-3 px-4 md:flex xl:hidden"
                style={{ paddingBottom: 'calc(1.125rem + env(safe-area-inset-bottom, 8px))' }}
            >
                <div className="w-[280px] shrink-0">
                    <WeaponSelector
                        weapons={weaponSlots}
                        selectedIndex={0}
                        onPrev={() => cycleWeapon(-1)}
                        onNext={() => cycleWeapon(1)}
                    />
                </div>
                <div className="flex w-[340px] shrink-0 items-stretch gap-2">
                    <ManeuverButton direction="left" disabled={!canManeuver} onClick={moveLeft} />
                    <ManeuverButton direction="right" disabled={!canManeuver} onClick={moveRight} />
                    <FireButton
                        disabled={!canFire}
                        hint="touch"
                        angle={angle}
                        power={power}
                        onClick={fire}
                    />
                </div>
            </div>

            {/* Десктоп/широкий (≥1280): полоса 124px, клавиатурная подсказка ниже ряда. */}
            <div
                data-testid="game-deck-desktop"
                className="pointer-events-auto hidden border-t-[length:var(--border-w)] border-border bg-panel px-[18px] py-3 xl:flex xl:h-[124px] xl:flex-col xl:items-center xl:justify-center xl:gap-2"
            >
                <div className="flex w-full max-w-[1280px] items-center justify-center gap-[18px]">
                    <div className="w-[300px] shrink-0">
                        <WeaponSelector
                            weapons={weaponSlots}
                            selectedIndex={0}
                            onPrev={() => cycleWeapon(-1)}
                            onNext={() => cycleWeapon(1)}
                        />
                    </div>
                    <ManeuverButton direction="left" disabled={!canManeuver} onClick={moveLeft} />
                    <ManeuverButton direction="right" disabled={!canManeuver} onClick={moveRight} />
                    <FireButton
                        disabled={!canFire}
                        hint="desktop"
                        angle={angle}
                        power={power}
                        onClick={fire}
                        className="min-w-[200px] flex-none"
                    />
                </div>
                <KeyboardSchemeHint />
            </div>
        </div>
    );
}
