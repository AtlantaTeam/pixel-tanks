export { GameCanvas } from './ui/game-canvas';
export { ReplayCanvas } from './ui/replay-canvas';
export { useGameStore, deriveOutcome, MAX_HP, MOVE_BUDGET } from './model/game.store';
export type { TSide, TPhase, TBattleOutcome } from './model/game.store';
export { computeBattleStats, computeLeaderboardPoints } from './lib/battle-stats';
export type { TBattleStats, TBattleStatsInput } from './lib/battle-stats';
export { parseSeedParam } from './lib/seed';
