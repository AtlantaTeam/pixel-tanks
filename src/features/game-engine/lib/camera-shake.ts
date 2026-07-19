import type { TSeededRandom } from '@/shared/lib/random';

/**
 * Screen shake на модели «травмы» (trauma, Squirrel Eiserloh): удар добавляет
 * травму в [0, 1], каждый кадр она затухает во времени, а смещение камеры
 * пропорционально `trauma²` — резкий старт и плавный хвост. Random инжектируется
 * (тот же seed движка), поэтому дрожание детерминировано для тестов и реплеев.
 *
 * Модуль чистый (не знает про Canvas): считает лишь смещение сцены в CSS-пикселях.
 * Рисование сдвинутой сцены — на стороне GamePlay.
 */

const TRAUMA_MAX = 1;
/** Максимальное смещение сцены при полной травме, CSS-пиксели. */
const DEFAULT_MAX_OFFSET = 14;
/** Скорость затухания травмы: единиц травмы в секунду (не привязано к FPS). */
const DEFAULT_DECAY_PER_SECOND = 1.8;

export type TCameraShakeOptions = {
    maxOffset?: number;
    decayPerSecond?: number;
};

export class CameraShake {
    private trauma = 0;
    private readonly maxOffset: number;
    private readonly decayPerSecond: number;
    private readonly random: TSeededRandom;
    private readonly reducedMotion: boolean;
    offsetX = 0;
    offsetY = 0;

    constructor(random: TSeededRandom, options: TCameraShakeOptions = {}) {
        this.random = random;
        this.maxOffset = options.maxOffset ?? DEFAULT_MAX_OFFSET;
        this.decayPerSecond = options.decayPerSecond ?? DEFAULT_DECAY_PER_SECOND;
        // Снимок настройки в момент создания движка (на бой). Смена системного
        // prefers-reduced-motion в середине боя — редкий кейс; осознанно НЕ
        // подписываемся на `matchMedia change`, чтобы не заводить слушатель без
        // парного teardown (класс живёт весь бой и dispose-хука не имеет).
        this.reducedMotion =
            typeof window !== 'undefined'
                ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
                : false;
    }

    /** Добавляет травму (сила удара). Итог клампится в [0, 1]. */
    addTrauma(amount: number): void {
        this.trauma = Math.min(TRAUMA_MAX, Math.max(0, this.trauma + amount));
    }

    /** Есть ли ещё дрожание — движок по этому флагу продолжает крутить кадры. */
    isActive(): boolean {
        return this.trauma > 0;
    }

    /**
     * Пересчитывает смещение из текущей травмы и продвигает затухание на `dtMs`
     * реального времени. Смещение по каждой оси ∈ [-maxOffset, maxOffset].
     * При prefers-reduced-motion травма сразу гасится (смещения нет, isActive →
     * false), чтобы animate не крутил пустые fullRedraw-кадры весь хвост затухания.
     */
    update(dtMs: number): void {
        if (this.trauma <= 0) {
            this.reset();
            return;
        }
        if (this.reducedMotion) {
            this.reset();
            return;
        }
        const shake = this.trauma * this.trauma;
        // random() ∈ [0, 1) → [-1, 1)
        this.offsetX = this.maxOffset * shake * (this.random() * 2 - 1);
        this.offsetY = this.maxOffset * shake * (this.random() * 2 - 1);
        this.trauma = Math.max(0, this.trauma - (this.decayPerSecond * dtMs) / 1000);
    }

    /** Полный сброс (рестарт боя). */
    reset(): void {
        this.trauma = 0;
        this.offsetX = 0;
        this.offsetY = 0;
    }
}
