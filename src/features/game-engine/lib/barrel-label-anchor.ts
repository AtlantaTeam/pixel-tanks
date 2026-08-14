import type { TCoords } from '@/shared/model';
import { WORLD_UNITS } from './world-scale';

/**
 * Зазор от дульного среза до подписи «угол·сила», CSS-пиксели. Длина ствола
 * (`WORLD_UNITS.gunpointWidth·scale`) учитывается отдельно — здесь только запас,
 * чтобы подпись не касалась среза. Не масштабируется: это визуальное «дыхание»
 * между стволом и текстом, а не часть геометрии ствола.
 */
export const BARREL_LABEL_GAP = 9;

/**
 * Точка якоря подписи у ствола: смещение от точки крепления (`gunpointX/Y`) ВДОЛЬ
 * вектора выстрела (`gunpointAngle`, issue #565), а не строго вверх. Смещение —
 * фактическая длина ствола (`gunpointWidth·scale`) плюс зазор `BARREL_LABEL_GAP`,
 * поэтому подпись садится за дульным срезом на любой ширине арены: при `scale` до
 * `WORLD_SCALE_MAX` (1.5) ствол доходит до ~52.5px, а фикс-константа 44px оставляла
 * подпись на срезе на широком десктопе (issue #565, ревью #574).
 *
 * Чистая геометрия без Canvas — детерминированный барьер по `.claude/rules/canvas.md`.
 */
export function computeBarrelLabelAnchor(
    gunpointX: number,
    gunpointY: number,
    angle: number,
    scale: number,
): TCoords {
    const offset = WORLD_UNITS.gunpointWidth * scale + BARREL_LABEL_GAP;
    return {
        x: gunpointX + Math.cos(angle) * offset,
        y: gunpointY + Math.sin(angle) * offset,
    };
}
