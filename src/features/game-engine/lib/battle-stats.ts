import { MAX_HP, MOVE_BUDGET } from '../model/game.store';

/**
 * Сырые входы статистики боя для экрана конца боя. Берутся из `game.store`
 * (или снимка `finalHp`): HP сторон, выстрелы/попадания игрока и число
 * совершённых манёвров.
 */
export type TBattleStatsInput = {
    playerHp: number;
    enemyHp: number;
    /** Сколько раз выстрелил игрок за бой. */
    shots: number;
    /** Сколько выстрелов игрока попали по противнику (для точности). */
    hits: number;
    /** Совершено манёвров — израсходовано из бюджета `MOVE_BUDGET`. */
    maneuvers: number;
};

/**
 * Готовая к показу статистика боя (handoff «Game over»): урон противнику,
 * точность в целых процентах, число выстрелов и совершённых манёвров из
 * бюджета. `remainingHp` в показ не идёт — он нужен как слагаемое очков
 * лидерборда (`computeLeaderboardPoints`).
 */
export type TBattleStats = {
    /** Урон, нанесённый противнику: `MAX_HP − enemyHp`, зажат в 0..MAX_HP. */
    damage: number;
    /** Точность игрока в целых процентах (0..100); при 0 выстрелов — 0. */
    accuracy: number;
    /** Число выстрелов игрока за бой. */
    shots: number;
    /** Совершено манёвров (0..MOVE_BUDGET). */
    maneuvers: number;
    /** Бюджет манёвров на матч — знаменатель показа «X / N» (GDD §2.3). */
    maneuverBudget: number;
    /** Остаток HP игрока (0..MAX_HP) — слагаемое очков лидерборда. */
    remainingHp: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Сводит сырые входы боя к статистике экрана конца боя. Чистая функция — общий
 * источник истины для оверлея, витрины и очков лидерборда, тестируется без DOM.
 */
export const computeBattleStats = ({
    playerHp,
    enemyHp,
    shots,
    hits,
    maneuvers,
}: TBattleStatsInput): TBattleStats => {
    const safeShots = Math.max(0, Math.floor(shots));
    const safeHits = clamp(Math.floor(hits), 0, safeShots);
    return {
        damage: clamp(MAX_HP - enemyHp, 0, MAX_HP),
        accuracy: safeShots > 0 ? Math.round((safeHits / safeShots) * 100) : 0,
        shots: safeShots,
        maneuvers: clamp(Math.floor(maneuvers), 0, MOVE_BUDGET),
        maneuverBudget: MOVE_BUDGET,
        remainingHp: clamp(playerHp, 0, MAX_HP),
    };
};

/**
 * Очки лидерборда — **производная метрика**, а не сырой HP (решение issue #422):
 * урон противнику + остаток своего HP + точность в процентах. Награждает
 * решительную победу (много урона, цел сам) и меткость, а не просто «выжил».
 * Всегда неотрицательное целое, потолок ≈ 3·MAX_HP — с запасом влезает в
 * `MAX_DAILY_POINTS`, поэтому схему коллекции `scores` менять не нужно.
 */
export const computeLeaderboardPoints = (stats: TBattleStats): number =>
    stats.damage + stats.remainingHp + stats.accuracy;
