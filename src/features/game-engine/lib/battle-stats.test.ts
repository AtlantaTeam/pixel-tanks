import { describe, expect, it } from 'vitest';
import { MAX_HP, MOVE_BUDGET } from '../model/game.store';
import { computeBattleStats, computeLeaderboardPoints } from './battle-stats';

describe('computeBattleStats', () => {
    it('урон = MAX_HP − оставшийся HP противника', () => {
        const stats = computeBattleStats({
            playerHp: 70,
            enemyHp: MAX_HP - 42,
            shots: 0,
            hits: 0,
            maneuvers: 0,
        });

        expect(stats.damage).toBe(42);
    });

    it('добитый противник (HP 0) даёт полный урон MAX_HP', () => {
        const stats = computeBattleStats({
            playerHp: 30,
            enemyHp: 0,
            shots: 5,
            hits: 3,
            maneuvers: 1,
        });

        expect(stats.damage).toBe(MAX_HP);
    });

    it('точность = попадания / выстрелы в целых процентах', () => {
        const stats = computeBattleStats({
            playerHp: 50,
            enemyHp: 40,
            shots: 8,
            hits: 5,
            maneuvers: 0,
        });

        // 5 / 8 = 62.5 % → округляется до 63 %.
        expect(stats.accuracy).toBe(63);
    });

    it('точность при нуле выстрелов равна нулю (без деления на ноль)', () => {
        const stats = computeBattleStats({
            playerHp: MAX_HP,
            enemyHp: MAX_HP,
            shots: 0,
            hits: 0,
            maneuvers: 0,
        });

        expect(stats.accuracy).toBe(0);
    });

    it('попаданий не может быть больше выстрелов — точность зажата в 100 %', () => {
        const stats = computeBattleStats({
            playerHp: 10,
            enemyHp: 0,
            shots: 3,
            hits: 9,
            maneuvers: 0,
        });

        expect(stats.accuracy).toBe(100);
    });

    it('манёвры отдаются вместе с бюджетом MOVE_BUDGET', () => {
        const stats = computeBattleStats({
            playerHp: 20,
            enemyHp: 20,
            shots: 4,
            hits: 2,
            maneuvers: 3,
        });

        expect(stats.maneuvers).toBe(3);
        expect(stats.maneuverBudget).toBe(MOVE_BUDGET);
    });

    it('манёвры зажаты в бюджет, отрицательный HP игрока — в ноль', () => {
        const stats = computeBattleStats({
            playerHp: -7,
            enemyHp: 55,
            shots: 2,
            hits: 1,
            maneuvers: 99,
        });

        expect(stats.maneuvers).toBe(MOVE_BUDGET);
        expect(stats.remainingHp).toBe(0);
    });
});

describe('computeLeaderboardPoints', () => {
    it('очки = урон + остаток HP + точность (производная метрика, не сырой HP)', () => {
        const stats = computeBattleStats({
            playerHp: 30,
            enemyHp: 10,
            shots: 8,
            hits: 5,
            maneuvers: 1,
        });

        // урон 90 + остаток HP 30 + точность 63 = 183.
        expect(computeLeaderboardPoints(stats)).toBe(90 + 30 + 63);
    });

    it('очки всегда неотрицательное целое даже при поражении с нулём HP', () => {
        const stats = computeBattleStats({
            playerHp: 0,
            enemyHp: 40,
            shots: 4,
            hits: 1,
            maneuvers: 2,
        });

        const points = computeLeaderboardPoints(stats);
        expect(points).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(points)).toBe(true);
    });
});
