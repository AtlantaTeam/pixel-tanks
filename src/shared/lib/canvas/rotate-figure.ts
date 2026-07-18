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
    return { angle, transformer: ctx.getTransform() };
};

export const transformPoint = (point: TCoords, matrix: DOMMatrix) => ({
    x: floor(matrix.a * point.x + matrix.c * point.y + matrix.e),
    y: floor(matrix.b * point.x + matrix.d * point.y + matrix.f),
});
