import { floor } from '@/shared/lib/canvas';
import type { TCoords } from '@/shared/model';

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

/**
 * Сколько узлов дуги предпросмотра строим (точки пунктирной ломаной от ствола).
 * Дуга показывает НЕ полёт до попадания, а первые ~30–40% пути — довести прицел
 * игрок обязан сам (критерий issue #475: «дуга, а не точка попадания»).
 */
export const TRAJECTORY_PREVIEW_POINTS = 14;
/** Тиков физики между соседними узлами дуги (реже узлов → длиннее дуга при тех же точках). */
export const TRAJECTORY_PREVIEW_STRIDE = 2;

/** Стартовые параметры дуги предпросмотра — позиция ствола, прицел и ветер боя. */
export type TTrajectoryPreviewInput = {
    /** Точка вылета снаряда (`Tank.calcBulletStartPos`) — начало дуги. */
    x: number;
    y: number;
    /** Угол ствола (радианы, конвенция `Tank.gunpointAngle`). */
    angle: number;
    /** Сила выстрела (как `Tank.power`). */
    power: number;
    /** Ветер боя (px/тик², как `GamePlay.wind`) — дуга обязана его учитывать. */
    wind: number;
    /** Логическая высота поля — гейт гравитации у нижней стены (как `Bullet.move`). */
    innerHeight: number;
    /** Радиус снаряда — тот же гейт гравитации/выхода за пол. */
    radius: number;
};

/**
 * Строит узлы дуги предпросмотра прицела в переданный буфер `out` (issue #475).
 * **Тем же шагом `advanceProjectile`, что и реальный полёт** — одно место правды:
 * дуга не может «врать» относительно траектории снаряда, потому что считается тем
 * же кодом с тем же ветром и той же начальной скоростью (`floor(cos/sin·power)` —
 * канон конструктора `Bullet`).
 *
 * Буфер `out` **преаллоцирован вызывающим** (кадровый цикл движка не аллоцирует —
 * `.claude/rules/canvas.md`): функция мутирует уже существующие точки и возвращает
 * число фактически заполненных узлов (≤ `out.length` и ≤ `points`). Первый узел —
 * не сама точка ствола (её рисует вызывающий как `moveTo`), а результат первого
 * шага, поэтому дуга сразу изгибается гравитацией и ветром.
 *
 * Ранний выход, если снаряд ушёл ниже пола (`y - radius > innerHeight`): дальше
 * дуга не нужна — предпросмотр короткий по замыслу.
 */
export function fillTrajectoryPreview(
    input: TTrajectoryPreviewInput,
    out: TCoords[],
    points: number = TRAJECTORY_PREVIEW_POINTS,
    stride: number = TRAJECTORY_PREVIEW_STRIDE,
): number {
    // Начальная скорость — бит-в-бит как в конструкторе Bullet (floor обязателен:
    // округление скорости входит в детерминизм полёта, дуга обязана его повторять).
    const step: TProjectileStep = {
        x: input.x,
        y: input.y,
        dx: floor(Math.cos(input.angle) * input.power),
        dy: floor(Math.sin(input.angle) * input.power),
    };
    const limit = Math.min(points, out.length);
    let count = 0;
    for (let p = 0; p < limit; p++) {
        for (let s = 0; s < stride; s++) {
            advanceProjectile(step, input.wind, step.y + input.radius < input.innerHeight);
        }
        const node = out[count];
        node.x = step.x;
        node.y = step.y;
        count += 1;
        if (step.y - input.radius > input.innerHeight) break;
    }
    return count;
}
