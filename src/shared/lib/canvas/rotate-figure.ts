import type { TCoords } from '@/shared/model';
import { floor } from './floor';

export const rotateFigureByAngle = (
    ctx: CanvasRenderingContext2D,
    angle: number,
    rotationPointX: number,
    rotationPointY: number,
) => {
    ctx.save();
    ctx.translate(rotationPointX, rotationPointY);
    ctx.rotate(angle);
    ctx.translate(-rotationPointX, -rotationPointY);
};

export const rotateFigure = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    rotationPointX: number,
    rotationPointY: number,
) => {
    ctx.save();
    const angle = Math.atan2(y - rotationPointY, x - rotationPointX);
    rotateFigureByAngle(ctx, angle, rotationPointX, rotationPointY);
    // Матрицу поворота считаем вручную в ЛОГИЧЕСКИХ координатах, а не через
    // ctx.getTransform(): базовый transform ctx масштабирован на dpr (ретина),
    // и getTransform() вернул бы матрицу с dpr. Но эта матрица используется для
    // hit-детекта (isPointInPath) и позиционирования дула (transformPoint) —
    // там всё в логических пикселях, dpr сломал бы физику. Так матрица совпадает
    // с поведением при dpr = 1.
    const transformer = new DOMMatrix()
        .translateSelf(rotationPointX, rotationPointY)
        .rotateSelf((angle * 180) / Math.PI)
        .translateSelf(-rotationPointX, -rotationPointY);
    return { angle, transformer };
};

export const transformPoint = (point: TCoords, matrix: DOMMatrix) => ({
    x: floor(matrix.a * point.x + matrix.c * point.y + matrix.e),
    y: floor(matrix.b * point.x + matrix.d * point.y + matrix.f),
});
