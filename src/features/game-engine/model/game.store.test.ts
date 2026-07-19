import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './game.store';

describe('game.store — запись реплея', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('изначально не имеет seed боя, размера поля и ходов', () => {
        const state = useGameStore.getState();

        expect(state.battleSeed).toBeNull();
        expect(state.battleField).toBeNull();
        expect(state.replayMoves).toEqual([]);
    });

    it('запоминает seed боя', () => {
        useGameStore.getState().setBattleSeed(42);

        expect(useGameStore.getState().battleSeed).toBe(42);
    });

    it('запоминает логический размер поля боя', () => {
        useGameStore.getState().setBattleField(1440, 810);

        expect(useGameStore.getState().battleField).toEqual({ width: 1440, height: 810 });
    });

    it('запоминает строковый seed боя', () => {
        useGameStore.getState().setBattleSeed('daily-2026-07-19');

        expect(useGameStore.getState().battleSeed).toBe('daily-2026-07-19');
    });

    it('добавляет ход перемещения в порядке вызовов', () => {
        useGameStore.getState().recordMove(-150);
        useGameStore.getState().recordMove(150);

        expect(useGameStore.getState().replayMoves).toEqual([
            { kind: 'move', delta: -150 },
            { kind: 'move', delta: 150 },
        ]);
    });

    it('добавляет ход выстрела', () => {
        useGameStore.getState().recordFire(1.23, 15);

        expect(useGameStore.getState().replayMoves).toEqual([
            { kind: 'fire', angle: 1.23, power: 15 },
        ]);
    });

    it('чередует ходы перемещения и выстрела в порядке записи', () => {
        useGameStore.getState().recordMove(-150);
        useGameStore.getState().recordFire(0.5, 10);

        expect(useGameStore.getState().replayMoves).toEqual([
            { kind: 'move', delta: -150 },
            { kind: 'fire', angle: 0.5, power: 10 },
        ]);
    });

    it('resetGame очищает seed боя, размер поля и записанные ходы', () => {
        useGameStore.getState().setBattleSeed('daily-2026-07-19');
        useGameStore.getState().setBattleField(800, 600);
        useGameStore.getState().recordMove(150);

        useGameStore.getState().resetGame();

        expect(useGameStore.getState().battleSeed).toBeNull();
        expect(useGameStore.getState().battleField).toBeNull();
        expect(useGameStore.getState().replayMoves).toEqual([]);
    });
});
