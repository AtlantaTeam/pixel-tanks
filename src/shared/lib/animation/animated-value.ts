/**
 * Плавный переход отображаемого числа к цели во времени экрана (мс реального
 * времени, НЕ игровой кадр движка) — для HUD-счётчиков (очки, ходы), которые
 * обновляются в сторе скачком. Ease-out: быстрый старт, плавное торможение
 * к цели. Модуль чистый, не знает про React/DOM — обёртка (use-animated-value)
 * лишь вызывает update() из requestAnimationFrame.
 */

const DEFAULT_DURATION_MS = 300;

export type TAnimatedValueOptions = {
    durationMs?: number;
};

export class AnimatedValue {
    private from: number;
    private to: number;
    private elapsedMs = 0;
    private readonly durationMs: number;
    current: number;

    constructor(initial: number, options: TAnimatedValueOptions = {}) {
        this.from = initial;
        this.to = initial;
        this.current = initial;
        this.durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
    }

    /** Задаёт новую цель — переход тянется от текущего отображаемого значения. */
    setTarget(target: number): void {
        if (target === this.to) return;
        this.from = this.current;
        this.to = target;
        this.elapsedMs = 0;
    }

    /** Идёт ли ещё переход (отображаемое значение ещё не догнало цель). */
    isActive(): boolean {
        return this.current !== this.to;
    }

    /** Продвигает переход на dtMs реального времени, возвращает новое отображаемое значение. */
    update(dtMs: number): number {
        if (this.from === this.to) {
            this.current = this.to;
            return this.current;
        }
        this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + dtMs);
        const progress = this.elapsedMs / this.durationMs;
        // easeOutQuad
        const eased = 1 - (1 - progress) * (1 - progress);
        this.current = progress >= 1 ? this.to : this.from + (this.to - this.from) * eased;
        return this.current;
    }
}
