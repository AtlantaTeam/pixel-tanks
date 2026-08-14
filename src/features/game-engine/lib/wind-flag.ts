import { MAX_WIND, windDirection, windMagnitude } from './wind';

/**
 * Флажок на башне своего танка (#550, §7 разбора #534): «дешёвый носитель» ветра
 * рядом с ареной, куда и так смотрит взгляд во время прицеливания — не только цифра
 * в ячейке «Ветер» наверху HUD. Модель чистая: угол поворота считается от `wind`
 * теми же `windDirection`/`windMagnitude`, что дают знак и пипы ячейки «Ветер»
 * (`wind.ts`) — флажок и HUD не могут разойтись в показаниях.
 */

/** Канонический размер флажка (CSS px, `scale === 1`) — Issue #550. */
export const WIND_FLAG_WIDTH = 6;
export const WIND_FLAG_HEIGHT = 10;
export const WIND_FLAG_POLE_HEIGHT = 5;

/**
 * Наклон флажка (градусы) от нейтрали по силе ветра (0..3 пипа шкалы HUD,
 * `WIND_DISPLAY_SCALE`) — три положения на сторону при магнитуде 1..3, индекс 0 —
 * штиль (наклона нет).
 */
const LEAN_DEG_BY_MAGNITUDE: readonly number[] = [0, 20, 40, 60];

/**
 * Угол поворота флажка в радианах для `ctx.rotate` вокруг вершины мачты. `90°`
 * (`Math.PI / 2`) — флажок висит вдоль мачты вниз: нейтраль на `wind = 0` (критерий
 * #550). С ростом силы ветра угол уходит к горизонтали — вправо (`< 90°`) при
 * `windDirection === 'right'`, влево (`> 90°`) при `'left'`, зеркально относительно
 * нейтрали при равной по модулю силе ветра разного знака.
 */
export function windFlagRotationRad(wind: number, maxWind = MAX_WIND): number {
    const magnitude = windMagnitude(wind, maxWind);
    const lean = LEAN_DEG_BY_MAGNITUDE[Math.min(magnitude, LEAN_DEG_BY_MAGNITUDE.length - 1)];
    const restDeg = 90;
    const rotatedDeg = windDirection(wind) === 'right' ? restDeg - lean : restDeg + lean;
    return (rotatedDeg * Math.PI) / 180;
}
