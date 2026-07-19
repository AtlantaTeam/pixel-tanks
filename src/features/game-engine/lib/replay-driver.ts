import type { TReplayMove } from '@/entities/replays';
import type { TWeapon } from '@/shared/model';

/**
 * Пауза между ходами игрока при воспроизведении, мс: реплей смотрится
 * в темпе живой партии, а не мгновенной очередью действий.
 */
export const REPLAY_MOVE_DELAY_MS = 700;

/** Действия, которые драйвер умеет применять к движку вместо игрока. */
export type TReplayEngine = {
    isReadyForNextMove: () => boolean;
    applyMove: (delta: number) => void;
    applyFire: (angle: number, power: number) => void;
};

/**
 * Подмножество GamePlay, нужное воспроизведению. Структурный тип вместо
 * прямой зависимости от класса — адаптер тестируется без Canvas и картинок.
 */
export type TReplayGameSurface = {
    leftTank?: {
        isActive: boolean;
        dx: number;
        dy: number;
        weapons: TWeapon[];
        gunpointAngle: number;
        power: number;
    };
    rightTank?: { dx: number; dy: number };
    ground?: { isFalling: boolean };
    bullet?: unknown;
    isFireMode: boolean;
    isMoveMode: boolean;
    changeTankPosition: (delta: number) => void;
    onFire: (weapon: TWeapon) => void;
};

/**
 * Мост между записью боя и движком: ход применяется только в «покое» хода
 * игрока — танки стоят, снаряд не летит, земля не осыпается. Это тот же момент,
 * в котором в живой игре ввод игрока вообще имеет эффект, поэтому воспроизведение
 * не может применить ход «раньше времени» и разойтись с оригиналом.
 */
export const createReplayEngineAdapter = (game: TReplayGameSurface): TReplayEngine => ({
    isReadyForNextMove: () =>
        !!game.leftTank?.isActive &&
        !game.isFireMode &&
        !game.isMoveMode &&
        !game.bullet &&
        !!game.ground &&
        !game.ground.isFalling &&
        !game.leftTank.dx &&
        !game.leftTank.dy &&
        !!game.rightTank &&
        !game.rightTank.dx &&
        !game.rightTank.dy,
    applyMove: (delta) => game.changeTankPosition(delta),
    applyFire: (angle, power) => {
        const tank = game.leftTank;
        if (!tank) return;
        // Записан только исход прицеливания (angle/power на момент выстрела),
        // поэтому промежуточные движения мыши не нужны — ставим значения напрямую.
        tank.gunpointAngle = angle;
        tank.power = power;
        const weapon = tank.weapons[0];
        if (!weapon) return;
        game.onFire(weapon);
    },
});

/**
 * Покадровый проигрыватель записи боя: на каждом тике проверяет готовность
 * движка и, выдержав паузу `delayMs` непрерывного покоя, применяет следующий
 * ход игрока. Ходы бота не применяет — бот детерминирован seed'ом и ходит сам.
 */
export class ReplayDriver {
    private index = 0;
    /** Момент, с которого движок непрерывно готов; null — готовность прервана. */
    private readySinceMs: number | null = null;

    constructor(
        private readonly moves: TReplayMove[],
        private readonly engine: TReplayEngine,
        private readonly delayMs: number = REPLAY_MOVE_DELAY_MS,
    ) {}

    get isFinished(): boolean {
        return this.index >= this.moves.length;
    }

    /** Возвращает true, если на этом тике применён очередной ход. */
    tick(nowMs: number): boolean {
        if (this.isFinished) return false;
        if (!this.engine.isReadyForNextMove()) {
            this.readySinceMs = null;
            return false;
        }
        if (this.readySinceMs === null) {
            this.readySinceMs = nowMs;
        }
        if (nowMs - this.readySinceMs < this.delayMs) return false;

        const move = this.moves[this.index];
        this.index += 1;
        this.readySinceMs = null;
        if (move.kind === 'move') {
            this.engine.applyMove(move.delta);
        } else {
            this.engine.applyFire(move.angle, move.power);
        }
        return true;
    }
}
