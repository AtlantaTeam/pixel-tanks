import { create } from 'zustand';
import type { TReplayMove } from '@/entities/replays';
import type { TWeapon } from '@/shared/model';
import { clampPower } from '../lib/power';

/** Максимум HP танка (GDD §2.5). HP боя живёт в диапазоне 0..MAX_HP. */
export const MAX_HP = 100;

/** Сторона боя, по которой адресуются HP и урон. Левый танк — игрок, правый — бот. */
export type TSide = 'player' | 'enemy';

/**
 * Фаза хода — по ней экран блокирует ввод и подписывает лок (handoff «Состояние»):
 * `idle` — покоя нет боя; `aiming` — ход игрока, можно целиться и стрелять;
 * `flight` — снаряд в полёте; `resolving` — попадание оседает; `over` — бой окончен.
 */
export type TPhase = 'idle' | 'aiming' | 'flight' | 'resolving' | 'over';

/** Исход законченного боя. Выводится из HP (не из очков) — см. `deriveOutcome`. */
export type TBattleOutcome = 'victory' | 'defeat' | 'draw';

/** Держит HP в границах боя: не ниже 0 и не выше максимума. */
const clampHp = (hp: number) => Math.min(MAX_HP, Math.max(0, hp));

/**
 * Исход боя по HP: победа — если у игрока HP больше, поражение — если меньше,
 * ничья — при равенстве (например, кончились снаряды при равном HP). Победа по
 * `hp <= 0` — частный случай сравнения: у убитого танка HP наименьший. Чистая
 * функция — общий источник истины для стора и для оверлея конца боя.
 */
export const deriveOutcome = (playerHp: number, enemyHp: number): TBattleOutcome =>
    playerHp > enemyHp ? 'victory' : playerHp < enemyHp ? 'defeat' : 'draw';

type TGameState = {
    angle: number;
    power: number;
    moves: number;
    /** HP сторон (0..MAX_HP). Заменяют очковую модель: попадание снимает урон. */
    hp: { player: number; enemy: number };
    weapons: TWeapon[];
    selectedWeapon: TWeapon | null;
    /** Фаза хода — экран лочит ввод по ней (см. `TPhase`). */
    phase: TPhase;
    /**
     * Ветер раскрыт точным числом. До первого выстрела игрок видит только
     * стрелку и грубую силу (GDD: первый выстрел — пристрелка); после — точное
     * значение до конца боя.
     */
    windRevealed: boolean;
    /** Сколько раз игрок выстрелил — для статистики экрана конца боя. */
    shotsFired: number;
    isGameOver: boolean;
    isStarted: boolean;
    /**
     * Снимок HP на переходе isGameOver false→true. Пока последние кадры боя
     * «оседают», hp может ещё чуть измениться — исход законченной игры
     * фиксируется один раз и не должен от этого дрожать (#337).
     */
    finalHp: { player: number; enemy: number } | null;
    /** Seed текущего боя — нужен для сборки ссылки-реплея после его окончания. */
    battleSeed: number | string | null;
    /**
     * Логический размер поля текущего боя (CSS-пиксели). Записывается в реплей:
     * без него воспроизведение на другом экране даст другой рельеф и счёт.
     */
    battleField: { width: number; height: number } | null;
    /** Ходы игрока текущего боя в порядке совершения (см. `@/entities/replays`). */
    replayMoves: TReplayMove[];
};

type TGameActions = {
    setAngle: (angle: number) => void;
    increaseAngle: (delta: number) => void;
    setPower: (power: number) => void;
    increasePower: (delta: number) => void;
    setMoves: (moves: number) => void;
    decrementMoves: () => void;
    /** Наносит урон стороне: HP цели уменьшается на `amount`, зажатый в 0..MAX_HP. */
    applyDamage: (target: TSide, amount: number) => void;
    setPhase: (phase: TPhase) => void;
    /**
     * Выстрел игрока: только из фазы прицеливания (`aiming`). Переводит в полёт,
     * считает выстрел и раскрывает ветер. Вне своей фазы — игнорируется (лок хода).
     */
    fire: () => void;
    setWeapons: (weapons: TWeapon[]) => void;
    selectWeapon: (weapon: TWeapon) => void;
    removeWeaponById: (id: number) => void;
    setGameOver: (over: boolean) => void;
    startGame: () => void;
    resetGame: () => void;
    setBattleSeed: (seed: number | string) => void;
    setBattleField: (width: number, height: number) => void;
    recordMove: (delta: number) => void;
    recordFire: (angle: number, power: number) => void;
};

const fullHp = () => ({ player: MAX_HP, enemy: MAX_HP });

export const useGameStore = create<TGameState & TGameActions>((set) => ({
    angle: 0,
    power: 10,
    moves: 4,
    hp: fullHp(),
    weapons: [],
    selectedWeapon: null,
    phase: 'idle',
    windRevealed: false,
    shotsFired: 0,
    isGameOver: false,
    isStarted: false,
    finalHp: null,
    battleSeed: null,
    battleField: null,
    replayMoves: [],

    setAngle: (angle) => set({ angle }),
    increaseAngle: (delta) => set((s) => ({ angle: s.angle + delta })),
    setPower: (power) => set({ power: clampPower(power) }),
    increasePower: (delta) => set((s) => ({ power: clampPower(s.power + delta) })),
    setMoves: (moves) => set({ moves }),
    decrementMoves: () => set((s) => ({ moves: s.moves - 1 })),
    applyDamage: (target, amount) =>
        set((s) => {
            const hp = { ...s.hp, [target]: clampHp(s.hp[target] - amount) };
            // Танк добит — бой окончен по HP (не по очкам). Исход фиксируется
            // один раз: снимок HP держит его стабильным на «оседающих» кадрах (#337).
            if ((hp.player <= 0 || hp.enemy <= 0) && !s.isGameOver) {
                return { hp, isGameOver: true, phase: 'over', finalHp: hp };
            }
            return { hp };
        }),
    setPhase: (phase) => set({ phase }),
    fire: () =>
        set((s) =>
            s.phase !== 'aiming'
                ? {}
                : { phase: 'flight', shotsFired: s.shotsFired + 1, windRevealed: true },
        ),
    setWeapons: (weapons) => set({ weapons }),
    selectWeapon: (selectedWeapon) => set({ selectedWeapon }),
    removeWeaponById: (id) =>
        set((s) => {
            const weapons = s.weapons.filter((w) => w.id !== id);
            const selectedWeapon =
                s.selectedWeapon?.id === id ? (weapons[0] ?? null) : s.selectedWeapon;
            return { weapons, selectedWeapon };
        }),
    setGameOver: (isGameOver) =>
        set((s) =>
            isGameOver && !s.isGameOver
                ? { isGameOver, phase: 'over', finalHp: s.hp }
                : { isGameOver },
        ),
    startGame: () =>
        set({
            isStarted: true,
            isGameOver: false,
            hp: fullHp(),
            phase: 'aiming',
            windRevealed: false,
            shotsFired: 0,
            finalHp: null,
        }),
    resetGame: () =>
        set({
            angle: 0,
            power: 10,
            moves: 4,
            hp: fullHp(),
            weapons: [],
            selectedWeapon: null,
            phase: 'idle',
            windRevealed: false,
            shotsFired: 0,
            isGameOver: false,
            isStarted: false,
            finalHp: null,
            battleSeed: null,
            battleField: null,
            replayMoves: [],
        }),
    setBattleSeed: (battleSeed) => set({ battleSeed }),
    setBattleField: (width, height) => set({ battleField: { width, height } }),
    recordMove: (delta) =>
        set((s) => ({ replayMoves: [...s.replayMoves, { kind: 'move', delta }] })),
    recordFire: (angle, power) =>
        set((s) => ({ replayMoves: [...s.replayMoves, { kind: 'fire', angle, power }] })),
}));
