import { beforeEach, describe, expect, it } from 'vitest';
import { POWER_MAX, POWER_MIN } from '../lib/power';
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

    it('не даёт увести мощность выше верхнего предела ни setPower, ни increasePower', () => {
        useGameStore.getState().setPower(999);
        expect(useGameStore.getState().power).toBe(POWER_MAX);

        // Экранная кнопка «Мощность» звала increasePower напрямую, минуя кламп
        // движка — теперь предел держит сам стор (#264).
        useGameStore.getState().setPower(POWER_MAX);
        useGameStore.getState().increasePower(5);
        expect(useGameStore.getState().power).toBe(POWER_MAX);
    });

    it('не даёт увести мощность ниже нижнего предела ни setPower, ни increasePower', () => {
        useGameStore.getState().setPower(-10);
        expect(useGameStore.getState().power).toBe(POWER_MIN);

        useGameStore.getState().setPower(POWER_MIN);
        useGameStore.getState().increasePower(-5);
        expect(useGameStore.getState().power).toBe(POWER_MIN);
    });

    it('оставляет мощность внутри диапазона без изменений', () => {
        useGameStore.getState().setPower(12);
        expect(useGameStore.getState().power).toBe(12);

        useGameStore.getState().increasePower(3);
        expect(useGameStore.getState().power).toBe(15);
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

describe('game.store — снимок очков на конце боя (#337)', () => {
    beforeEach(() => {
        useGameStore.getState().resetGame();
    });

    it('не имеет зафиксированного снимка очков до конца боя', () => {
        const state = useGameStore.getState();

        expect(state.finalPlayerPoints).toBeNull();
        expect(state.finalEnemyPoints).toBeNull();
    });

    it('фиксирует очки один раз на переходе isGameOver false→true', () => {
        useGameStore.getState().setPlayerPoints(10);
        useGameStore.getState().setEnemyPoints(5);

        useGameStore.getState().setGameOver(true);

        expect(useGameStore.getState().finalPlayerPoints).toBe(10);
        expect(useGameStore.getState().finalEnemyPoints).toBe(5);
    });

    it('не переписывает снимок, если очки меняются после фиксации исхода', () => {
        useGameStore.getState().setPlayerPoints(10);
        useGameStore.getState().setEnemyPoints(10);
        useGameStore.getState().setGameOver(true);

        // «Оседающие» очки последних кадров боя (root-cause #337) — после
        // фиксации исход больше не должен на них реагировать.
        useGameStore.getState().setPlayerPoints(5);

        expect(useGameStore.getState().finalPlayerPoints).toBe(10);
        expect(useGameStore.getState().finalEnemyPoints).toBe(10);
    });

    it('сбрасывает снимок при startGame и resetGame', () => {
        useGameStore.getState().setPlayerPoints(10);
        useGameStore.getState().setGameOver(true);

        useGameStore.getState().startGame();

        expect(useGameStore.getState().finalPlayerPoints).toBeNull();
        expect(useGameStore.getState().finalEnemyPoints).toBeNull();

        useGameStore.getState().setPlayerPoints(7);
        useGameStore.getState().setGameOver(true);
        useGameStore.getState().resetGame();

        expect(useGameStore.getState().finalPlayerPoints).toBeNull();
        expect(useGameStore.getState().finalEnemyPoints).toBeNull();
    });
});
