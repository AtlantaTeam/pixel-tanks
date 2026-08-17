export { GameCanvas } from './ui/game-canvas';
export type { TGameCanvasHandle } from './ui/game-canvas';
export { ReplayCanvas } from './ui/replay-canvas';
export { SkyBackground } from './ui/sky-background';
export { PrecipitationLayer } from './ui/precipitation-layer';
export { WindDustLayer } from './ui/wind-dust-layer';
export { TankWheelDemo } from './ui/tank-wheel-demo';
export type { TTankWheelDemoProps } from './ui/tank-wheel-demo';
export { WeaponFxDemo } from './ui/weapon-fx-demo';
export type { TWeaponFxDemoProps } from './ui/weapon-fx-demo';
export { WindFlagDemo, WIND_FLAG_DEMO_FRAME } from './ui/wind-flag-demo';
export type { TWindFlagDemoProps } from './ui/wind-flag-demo';
export { SKY_PRESETS } from './lib/sky-preset';
export type { TSkyPreset, TSkyPresetId } from './lib/sky-preset';
export { PRECIP_PRESETS } from './lib/precipitation';
export type { TPrecipPreset, TPrecipPresetId } from './lib/precipitation';
export {
    useGameStore,
    deriveOutcome,
    selectIsBotTurn,
    selectShowAmmoEmptyToast,
    selectShowGestureHint,
    MAX_HP,
    MOVE_BUDGET,
} from './model/game.store';
export type { TSide, TPhase, TBattleOutcome } from './model/game.store';
export { computeBattleStats, computeLeaderboardPoints } from './lib/battle-stats';
export type { TBattleStats, TBattleStatsInput } from './lib/battle-stats';
export { parseSeedParam } from './lib/seed';
export { formatAngle } from './lib/format-angle';
export { useArenaInset } from './lib/use-arena-inset';
export { computeArenaZone, EMPTY_ARENA_INSETS } from './lib/arena-insets';
export type { TArenaInsets, TArenaZone } from './lib/arena-insets';
export { WEAPONS_AMOUNT } from './lib/weapons';
export { MAX_WIND, WIND_DISPLAY_SCALE, windDirection, windMagnitude } from './lib/wind';
export type { TWindDirection } from './lib/wind';
