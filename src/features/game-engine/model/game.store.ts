import { create } from 'zustand';
import type { TReplayMove } from '@/entities/replays';
import type { TWeapon } from '@/shared/model';

type TGameState = {
    angle: number;
    power: number;
    moves: number;
    playerPoints: number;
    enemyPoints: number;
    weapons: TWeapon[];
    selectedWeapon: TWeapon | null;
    isGameOver: boolean;
    isStarted: boolean;
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
    setPlayerPoints: (points: number) => void;
    increasePlayerPoints: (delta: number) => void;
    setEnemyPoints: (points: number) => void;
    increaseEnemyPoints: (delta: number) => void;
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

export const useGameStore = create<TGameState & TGameActions>((set) => ({
    angle: 0,
    power: 10,
    moves: 4,
    playerPoints: 0,
    enemyPoints: 0,
    weapons: [],
    selectedWeapon: null,
    isGameOver: false,
    isStarted: false,
    battleSeed: null,
    battleField: null,
    replayMoves: [],

    setAngle: (angle) => set({ angle }),
    increaseAngle: (delta) => set((s) => ({ angle: s.angle + delta })),
    setPower: (power) => set({ power }),
    increasePower: (delta) => set((s) => ({ power: s.power + delta })),
    setMoves: (moves) => set({ moves }),
    decrementMoves: () => set((s) => ({ moves: s.moves - 1 })),
    setPlayerPoints: (playerPoints) => set({ playerPoints }),
    increasePlayerPoints: (delta) => set((s) => ({ playerPoints: s.playerPoints + delta })),
    setEnemyPoints: (enemyPoints) => set({ enemyPoints }),
    increaseEnemyPoints: (delta) => set((s) => ({ enemyPoints: s.enemyPoints + delta })),
    setWeapons: (weapons) => set({ weapons }),
    selectWeapon: (selectedWeapon) => set({ selectedWeapon }),
    removeWeaponById: (id) =>
        set((s) => {
            const weapons = s.weapons.filter((w) => w.id !== id);
            const selectedWeapon =
                s.selectedWeapon?.id === id ? (weapons[0] ?? null) : s.selectedWeapon;
            return { weapons, selectedWeapon };
        }),
    setGameOver: (isGameOver) => set({ isGameOver }),
    startGame: () => set({ isStarted: true, isGameOver: false }),
    resetGame: () =>
        set({
            angle: 0,
            power: 10,
            moves: 4,
            playerPoints: 0,
            enemyPoints: 0,
            weapons: [],
            selectedWeapon: null,
            isGameOver: false,
            isStarted: false,
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
