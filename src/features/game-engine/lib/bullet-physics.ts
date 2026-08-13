import { floor } from '@/shared/lib/canvas';

/**
 * Гравитация снаряда (px/тик²) — канон прежней константы `Bullet.gravity`.
 * Вынесена сюда, чтобы предпросмотр траектории (`fillTrajectoryPreview`) и реальный
 * полёт (`Bullet`) считали ускорение одним и тем же числом (issue #475).
 */
export const BULLET_GRAVITY = 0.1;

/** Минимальная форма вектора снаряда для шага физики (позиция + скорость). */
export type TProjectileStep = { x: number; y: number; dx: number; dy: number };

/**
 * Один тик физики снаряда — **единый шаг** и для реального полёта (`Bullet.move`),
 * и для дуги предпросмотра прицела (`fillTrajectoryPreview`, issue #475). Одно
 * место правды: если бы предпросмотр считался отдельной формулой, дуга «врала» бы
 * относительно полёта, а это хуже, чем её отсутствие (критерий issue).
 *
 * Мутирует переданный вектор на месте — без аллокации в кадре
 * (`.claude/rules/canvas.md`). `applyGravity` повторяет гейт `Bullet.move`: у самой
 * нижней стены снаряд гравитацией уже не притягивается (иначе он «продавливал» бы
 * пол). Порядок операций (gravity → wind → floor позиции) обязан совпадать с
 * прежним телом `Bullet.move` до бита — детерминизм реплеев на этом держится.
 */
export function advanceProjectile(
    v: TProjectileStep,
    wind: number,
    applyGravity: boolean,
    gravity: number = BULLET_GRAVITY,
): void {
    if (applyGravity) v.dy += gravity;
    v.dx += wind;
    v.x = floor(v.x + v.dx);
    v.y = floor(v.y + v.dy);
}
