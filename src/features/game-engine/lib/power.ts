/**
 * Единый предел силы выстрела на всех путях ввода (кнопка, колесо, клавиши,
 * drag-aim). Раньше кламп жил только в `game-play.changeTankPower` — экранная
 * кнопка звала `increasePower` напрямую и уводила силу выше предела, снаряд
 * стартовал с огромной скоростью и улетал за поле (#264).
 *
 * Совпадает с `Tank.powerMin/powerMax` и диапазоном кодека реплеев — держим
 * значения здесь как единственный источник.
 */
export const POWER_MIN = 1;
export const POWER_MAX = 20;

/** Зажимает силу выстрела в допустимый диапазон [POWER_MIN, POWER_MAX]. */
export const clampPower = (power: number) => Math.min(POWER_MAX, Math.max(POWER_MIN, power));
