import { floor, rotateFigure, rotateFigureByAngle, transformPoint } from '@/shared/lib/canvas';
import type { TCoords, TWeapon } from '@/shared/model';
import { Ground } from './ground';
import { POWER_MAX, POWER_MIN } from './power';
import { WORLD_UNITS } from './world-scale';

type TGroundUnderTankData = {
    leftSideX: number;
    rightSideX: number;
    xBySortedHeights: { x: number; index: number }[];
    ground: Ground;
};

export class Tank {
    /**
     * Коэффициент масштаба мира, которым посчитаны все размеры танка (issue #455).
     * `scale === 1` — канон прежних пиксельных констант (60×30, ствол 35×5). Меняется
     * ресайзом через `setScale`. Снаряд читает его (`Bullet` берёт `activeTank.scale`),
     * чтобы радиус снаряда и взрыва масштабировались вместе с телом.
     */
    scale: number;
    private gunpointDeltaX: number;
    private gunpointDeltaY: number;
    tankWidth: number;
    tankHeight: number;
    private gunpointWidth: number;
    private gunpointHeight: number;
    gunpointAngle: number;
    gunpointAngleMin = 0;
    gunpointAngleMax = 2 * Math.PI;
    private tankBodyImg: HTMLImageElement | undefined;
    private gunpointImg: HTMLImageElement | undefined;
    x: number;
    y: number;
    gunpointX: number;
    gunpointY: number;
    isActive = false;
    canHarmYourself = true;
    tankHitArea: Path2D;
    tankHitAreaCtx: CanvasRenderingContext2D | undefined;
    currentTransformer: DOMMatrix | undefined;
    innerWidth: number;
    innerHeight: number;
    dx = 0;
    dy = 0;
    power = 10;
    powerMin = POWER_MIN;
    powerMax = POWER_MAX;
    gravity = 0;
    isReadyToFire = true;
    closestToHit: { minDiff: number; angle: number; power: number; count: number } | null;
    weapons: TWeapon[];

    constructor(
        x: number,
        y: number,
        innerWidth: number,
        innerHeight: number,
        gunpointAngle: number,
        weapons: TWeapon[],
        tankBodyImg?: HTMLImageElement,
        gunpointImg?: HTMLImageElement,
        scale = 1,
    ) {
        this.scale = scale;
        this.gunpointDeltaX = WORLD_UNITS.gunpointDeltaX * scale;
        this.gunpointDeltaY = WORLD_UNITS.gunpointDeltaY * scale;
        this.tankWidth = WORLD_UNITS.tankWidth * scale;
        this.tankHeight = WORLD_UNITS.tankHeight * scale;
        this.gunpointWidth = WORLD_UNITS.gunpointWidth * scale;
        this.gunpointHeight = WORLD_UNITS.gunpointHeight * scale;
        this.gunpointAngle = gunpointAngle;
        this.tankHitArea = new Path2D();
        this.weapons = weapons;
        this.tankBodyImg = tankBodyImg;
        this.gunpointImg = gunpointImg;
        this.innerWidth = innerWidth;
        this.innerHeight = innerHeight;
        this.x = x;
        this.y = y;
        this.gunpointX = this.x + this.gunpointDeltaX;
        this.gunpointY = this.y - this.gunpointDeltaY;
        this.closestToHit = null;
    }

    /**
     * Пересчитывает размеры танка под новый масштаб мира (issue #455). Зовётся
     * ресайзом/поворотом, когда ширина арены (а с ней коэффициент) изменилась;
     * `GamePlay.rescaleTerrainAndTanks` следом переставляет `x`/`y`. Точку крепления
     * ствола обновляем от новой дельты — ресайз всё равно переустановит `x`/`y`.
     */
    setScale(scale: number) {
        this.scale = scale;
        this.gunpointDeltaX = WORLD_UNITS.gunpointDeltaX * scale;
        this.gunpointDeltaY = WORLD_UNITS.gunpointDeltaY * scale;
        this.tankWidth = WORLD_UNITS.tankWidth * scale;
        this.tankHeight = WORLD_UNITS.tankHeight * scale;
        this.gunpointWidth = WORLD_UNITS.gunpointWidth * scale;
        this.gunpointHeight = WORLD_UNITS.gunpointHeight * scale;
        this.gunpointX = this.x + this.gunpointDeltaX;
        this.gunpointY = this.y - this.gunpointDeltaY;
    }

    /**
     * Прямоугольник корпуса танка (CSS-пиксели) — **единственный источник** и для
     * отрисовки тела (`drawImage`), и для хит-зоны (`tankHitArea`). Общий источник
     * гарантирует, что попадание засчитывается ровно там, где видно касание, при
     * любом масштабе (критерий #455): тело рисуется от `y - tankHeight` вверх, и
     * `tankHeight` здесь тот же, что в размерах танка.
     */
    bodyRect() {
        return {
            x: floor(this.x),
            y: floor(this.y - this.tankHeight),
            width: this.tankWidth,
            height: this.tankHeight,
        };
    }

    calcBulletStartPos() {
        const { y: scrollY } = document.querySelector('.game-canvas')?.getBoundingClientRect() || {
            y: 0,
        };
        return {
            x: this.gunpointX + this.gunpointWidth * Math.cos(this.gunpointAngle),
            y: this.gunpointY - scrollY + this.gunpointWidth * Math.sin(this.gunpointAngle),
        };
    }

    fire = (weaponType: TWeapon) => {
        this.weapons = this.weapons.filter((weapon) => weapon !== weaponType);
    };

    move = () => {
        const step = 2;
        const direction = this.dx > 0 ? 1 : -1;
        if (this.x + this.tankWidth + step < this.innerWidth && this.x - step > 0) {
            if (Math.abs(this.dx) > step) {
                this.x += direction * step;
            } else {
                this.x += direction * this.dx;
            }
            this.dx -= direction * step;
        } else {
            this.dx = 0;
        }
        this.gunpointX = this.x + this.gunpointDeltaX;
        this.gunpointY = this.y - this.gunpointDeltaY;
    };

    jump(highestYUnderTank: number) {
        if (this.x + this.tankWidth > this.innerWidth || this.x < 0) {
            this.dx *= -1;
        }

        if (this.y < this.innerHeight) {
            this.dy += this.gravity;
        }

        if (this.y >= this.innerHeight - highestYUnderTank) {
            if (this.dy < 0) {
                this.y += this.dy;
            } else {
                this.dx = 0;
                this.dy = 0;
            }
        } else {
            this.x += this.dx;
            this.y += this.dy;
        }

        this.gunpointX = this.x + this.gunpointDeltaX;
        this.gunpointY = this.y - this.gunpointDeltaY;
    }

    jumpOnHit(hitPower: number, gravity: number, dx: number) {
        if (!this.dx && !this.dy) {
            this.gravity = gravity;
            // TODO: когда появится разное по мощности оружие, dx и dy зависят от hitPower
            this.dx = floor(dx / 5);
            this.dy = -Math.abs(floor(dx / 3));
        }
    }

    slopeTank(ctx: CanvasRenderingContext2D, data: TGroundUnderTankData) {
        const { leftSideX, rightSideX, xBySortedHeights, ground } = data;
        const firstHighestX = xBySortedHeights[0].x;
        // Второй опорный столбец — 11-й по высоте; на малом масштабе полоса под
        // корпусом короче 11 столбцов, поэтому индекс зажимаем длиной массива
        // (#455 уменьшает танк — без клампа было бы обращение к undefined).
        const secondHighestIndex = Math.min(10, xBySortedHeights.length - 1);
        let secondHighestX = xBySortedHeights[secondHighestIndex].x;

        const slopeClockwise = firstHighestX < leftSideX + (rightSideX - leftSideX) / 2;
        const tankBeginX = slopeClockwise ? firstHighestX : leftSideX;
        const tankEndX = slopeClockwise ? rightSideX : firstHighestX;
        const restOfTankWidth = this.tankWidth / 4;
        let bestAngleToHorizon = slopeClockwise ? Math.PI : 0;

        for (let i = 0; i < xBySortedHeights.length; i++) {
            const current = xBySortedHeights[i];
            const angleToHorizon = Math.atan2(
                this.innerHeight - ground.heights[current.x],
                current.x,
            );
            if (
                tankBeginX < current.x &&
                current.x < tankEndX &&
                Math.abs(current.x - firstHighestX) > restOfTankWidth &&
                ((slopeClockwise && bestAngleToHorizon > angleToHorizon) ||
                    (!slopeClockwise && bestAngleToHorizon < angleToHorizon))
            ) {
                bestAngleToHorizon = Math.atan2(
                    this.innerHeight - ground.heights[current.x],
                    current.x,
                );
                secondHighestX = current.x;

                const xDiff = Math.abs(firstHighestX - secondHighestX);
                const yDiff = Math.abs(
                    ground.heights[firstHighestX] - ground.heights[secondHighestX],
                );
                const xyHypo = Math.sqrt(xDiff * xDiff + yDiff * yDiff);
                if (xyHypo > this.tankWidth) {
                    break;
                }
            }
        }

        const [x, y, rotationPointX, rotationPointY] = [
            slopeClockwise ? secondHighestX : firstHighestX,
            slopeClockwise
                ? this.innerHeight - ground.heights[secondHighestX]
                : this.innerHeight - ground.heights[firstHighestX],
            slopeClockwise ? firstHighestX : secondHighestX,
            slopeClockwise
                ? this.innerHeight - ground.heights[firstHighestX]
                : this.innerHeight - ground.heights[secondHighestX],
        ];
        const { transformer } = rotateFigure(ctx, x, y, rotationPointX, rotationPointY);
        this.currentTransformer = transformer;
        return { x: rotationPointX, y: rotationPointY };
    }

    private getGroundUnderTankData(ground: Ground) {
        // Отступы под наклон корпуса пропорциональны ширине танка (масштаб мира,
        // #455): при scale === 1 это ровно прежние 10 и 15 (tankWidth/6, tankWidth/4),
        // на меньшем масштабе полоса не схлопывается в ноль (иначе индекс в slopeTank
        // вышел бы за пределы отсортированного массива высот).
        const leftSideX = floor(this.x) + floor(this.tankWidth / 6);
        const rightSideX = floor(this.x + this.tankWidth) - floor(this.tankWidth / 4);
        const xBySortedHeights = [];

        for (let index = 0, xCur = leftSideX; xCur <= rightSideX; xCur++, index++) {
            xBySortedHeights.push({ x: xCur, index });
        }
        xBySortedHeights.sort((a, b) => ground.heights[b.x] - ground.heights[a.x]);
        return {
            leftSideX,
            rightSideX,
            xBySortedHeights,
            highestPointUnderTank: {
                x: xBySortedHeights[0].x,
                y: ground.heights[xBySortedHeights[0].x],
            },
            ground,
        };
    }

    recalcPosition(ctx: CanvasRenderingContext2D, ground: Ground) {
        const { highestPointUnderTank, ...rest } = this.getGroundUnderTankData(ground);
        if (this.dx && !this.dy) {
            this.move();
        }
        if (this.dy) {
            this.jump(highestPointUnderTank.y);
        } else {
            const { y } = this.slopeTank(ctx, rest);
            this.y = y;
            if (this.currentTransformer) {
                const { x: newX, y: newY } = transformPoint(
                    { x: this.x + this.gunpointDeltaX, y: this.y - this.gunpointDeltaY },
                    this.currentTransformer,
                );
                this.gunpointX = floor(newX);
                this.gunpointY = floor(newY);
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D, mousePos: TCoords | null, ground: Ground) {
        this.recalcPosition(ctx, ground);
        const body = this.bodyRect();
        if (this.tankBodyImg) {
            ctx.drawImage(this.tankBodyImg, body.x, body.y, body.width, body.height);
        }
        this.tankHitArea = new Path2D();
        this.tankHitArea.rect(body.x, body.y, body.width, body.height);
        this.tankHitAreaCtx = ctx;
        ctx.restore();

        if (mousePos && this.isActive) {
            const { x, y } = mousePos;
            const { angle } = rotateFigure(ctx, floor(x), floor(y), this.gunpointX, this.gunpointY);
            this.gunpointAngle = angle;
        } else {
            rotateFigureByAngle(ctx, this.gunpointAngle, this.gunpointX, this.gunpointY);
        }
        if (this.gunpointImg) {
            ctx.drawImage(
                this.gunpointImg,
                this.gunpointX,
                this.gunpointY,
                this.gunpointWidth,
                this.gunpointHeight,
            );
        }
        ctx.restore();
        const { y: scrollY } = document.querySelector('.game-canvas')?.getBoundingClientRect() || {
            y: 0,
        };
        this.gunpointY += scrollY;
    }
}
