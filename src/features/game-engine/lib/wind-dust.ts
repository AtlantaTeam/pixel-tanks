import { createSeededRandom } from '@/shared/lib/random';
import { MAX_WIND, windMagnitude } from './wind';

/**
 * Пылинки приземного слоя, летящие по ветру (#550, §7 разбора #534) — второй
 * «дешёвый носитель» ветра в арене, рядом с флажком на башне. Плотность растёт с
 * силой ветра (0..3 пипа шкалы HUD, `windMagnitude`) — на `wind = 0` пылинок нет
 * вовсе (критерий #550). Раскладка — детерминированный поток RNG с суффиксом
 * `::wind-dust` (тот же приём, что `precipitation.ts`/`sky-celestial.ts`): один сид
 * даёт ту же раскладку кадр в кадр, отдельно от боевого потока (реплей не расходится).
 * Рисование — в `wind-dust-scene.ts` (`.claude/rules/canvas.md`: рендер отделён от
 * состояния).
 */

export type TWindDustParticle = {
    /** Стартовая позиция как доля ширины поля, [0, 1). */
    xFrac: number;
    /** Позиция как доля высоты канваса — приземный слой, нижняя полоса. */
    yFrac: number;
    /** Индивидуальный множитель скорости сноса — частицы не «гребёнка». */
    speed: number;
    /** Базовая альфа частицы. */
    alpha: number;
};

/** Нижняя полоса канваса, где летят пылинки — приземный слой, не всё небо. */
export const WIND_DUST_BAND_MIN = 0.78;
export const WIND_DUST_BAND_MAX = 0.98;

/** Число пылинок по силе ветра (0..3 пипа шкалы HUD): 0 при штиле, растёт со шкалой. */
const DUST_COUNT_BY_MAGNITUDE: readonly number[] = [0, 5, 10, 16];

/** Число пылинок под текущий ветер (плотность от `windMagnitude`, как у HUD-пипов). */
export function windDustCount(wind: number, maxWind = MAX_WIND): number {
    const magnitude = windMagnitude(wind, maxWind);
    return DUST_COUNT_BY_MAGNITUDE[Math.min(magnitude, DUST_COUNT_BY_MAGNITUDE.length - 1)];
}

/**
 * Раскладывает пылинки детерминированно от сида боя: один сид — то же поле
 * (критерий #550, «побитовое совпадение кадров»). Поток RNG отделён суффиксом
 * `::wind-dust`, чтобы не сдвинуть боевую последовательность (рельеф, ветер, бот).
 */
export function buildWindDustField(
    seed: number | string,
    wind: number,
    maxWind = MAX_WIND,
): TWindDustParticle[] {
    const count = windDustCount(wind, maxWind);
    if (count === 0) return [];
    const random = createSeededRandom(`${seed}::wind-dust`);
    const field: TWindDustParticle[] = [];
    for (let i = 0; i < count; i++) {
        field.push({
            xFrac: random(),
            yFrac: WIND_DUST_BAND_MIN + random() * (WIND_DUST_BAND_MAX - WIND_DUST_BAND_MIN),
            speed: 0.6 + random() * 0.8,
            alpha: 0.25 + random() * 0.35,
        });
    }
    return field;
}
