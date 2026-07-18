/**
 * Контроллер slow-mo: короткое замедление времени в момент попадания в танк.
 * Не знает про Canvas и физику — лишь считает текущий масштаб времени (`timeScale`)
 * по реальному времени. Движок делит на него интервал кадра, поэтому симуляция
 * (взрыв, частицы, осыпание земли) на это окно идёт медленнее.
 *
 * Масштаб плавно возвращается к 1 к концу окна (линейный ease-out), чтобы не было
 * резкого «щелчка» скорости на выходе.
 */

/** Доля нормальной скорости на пике замедления (0 < factor ≤ 1). */
const DEFAULT_FACTOR = 0.35;
/** Длительность окна замедления, мс реального времени. */
const DEFAULT_DURATION_MS = 320;

export type TSlowMotionOptions = {
    factor?: number;
    durationMs?: number;
};

export class SlowMotion {
    private remainingMs = 0;
    private durationMs = 0;
    private factor = 1;

    /** Запускает окно замедления. Повторный вызов перезапускает его целиком. */
    trigger(options: TSlowMotionOptions = {}): void {
        this.durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
        this.factor = options.factor ?? DEFAULT_FACTOR;
        this.remainingMs = this.durationMs;
    }

    /** Активно ли замедление сейчас. */
    isActive(): boolean {
        return this.remainingMs > 0;
    }

    /**
     * Списывает `dtMs` реального времени и возвращает текущий масштаб времени:
     * `factor` на старте окна → плавно к `1` к его концу. Вне окна всегда `1`.
     */
    update(dtMs: number): number {
        if (this.remainingMs <= 0) {
            this.remainingMs = 0;
            return 1;
        }
        const progress = 1 - this.remainingMs / this.durationMs;
        const scale = this.factor + (1 - this.factor) * progress;
        this.remainingMs = Math.max(0, this.remainingMs - dtMs);
        return scale;
    }

    /** Полный сброс (рестарт боя). */
    reset(): void {
        this.remainingMs = 0;
    }
}
