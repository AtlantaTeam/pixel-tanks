export { GameCanvas } from './ui/game-canvas';
export type { TGameCanvasHandle } from './ui/game-canvas';
export { ReplayCanvas } from './ui/replay-canvas';
export {
    useGameStore,
    deriveOutcome,
    selectIsBotTurn,
    MAX_HP,
    MOVE_BUDGET,
} from './model/game.store';
export type { TSide, TPhase, TBattleOutcome } from './model/game.store';
export { computeBattleStats, computeLeaderboardPoints } from './lib/battle-stats';
export type { TBattleStats, TBattleStatsInput } from './lib/battle-stats';
export { parseSeedParam } from './lib/seed';
export { formatAngle } from './lib/format-angle';
export { WEAPONS_AMOUNT } from './lib/weapons';
export { MAX_WIND, WIND_DISPLAY_SCALE, windDirection, windMagnitude } from './lib/wind';
export type { TWindDirection } from './lib/wind';
