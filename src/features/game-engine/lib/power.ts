/**
 * Кламп силы выстрела на всех путях ввода (кнопка, колесо, клавиши, drag-aim).
 * Раньше кламп жил только в `game-play.changeTankPower` — экранная кнопка звала
 * `increasePower` напрямую и уводила силу выше предела, снаряд стартовал с
 * огромной скоростью и улетал за поле (#264).
 *
 * Пределы `POWER_MIN/POWER_MAX` — единый источник в `shared/config` (их же читают
 * `Tank.powerMin/powerMax`, `drag-aim` и кодек реплеев). Реэкспортим отсюда, чтобы
 * не менять существующие импорты внутри `game-engine`.
 */
import { POWER_MAX, POWER_MIN } from '@/shared/config';

export { POWER_MIN, POWER_MAX };

/** Зажимает силу выстрела в допустимый диапазон [POWER_MIN, POWER_MAX]. */
export const clampPower = (power: number) => Math.min(POWER_MAX, Math.max(POWER_MIN, power));
