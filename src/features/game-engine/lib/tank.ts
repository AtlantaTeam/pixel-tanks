import { floor, rotateFigure, rotateFigureByAngle, transformPoint } from '@/shared/lib/canvas';
import type { TCoords, TWeapon } from '@/shared/model';
import { Ground } from './ground';
import { POWER_MAX, POWER_MIN } from './power';
import type { TLightDirection } from './scene-light';
import { WORLD_UNITS } from './world-scale';

/**
 * Тень танка от светила (#545): эллипс под корпусом на поверхности рельефа, смещённый
 * в сторону, противоположную светилу (`direction.dx` — горизонталь направления света).
 * `null` (день без модели света/до светила) — тень не рисуется.
 */
export type TTankShadow = { direction: TLightDirection; color: string } | null;

/** Полутень корпуса: тёмный полупрозрачный тон, читается на песке любого пресета. */
export const TANK_SHADOW_COLOR = 'rgba(12, 10, 8, 0.32)';

type TGroundUnderTankData = {
    leftSideX: number;
    rightSideX: number;
    xBySortedHeights: { x: number; index: number }[];
    ground: Ground;
};

/**
 * Каток — центр и радиус как доля ширины/высоты корпуса (0..1), НЕ пиксели
 * исходного SVG (issue #496): корпус растягивается в `bodyRect()` под текущий
 * `scale`, а доля от него не зависит. По форме совпадает с
 * `TTankGeometry['wheels']` из `entities/tank-skins` — `Tank` намеренно ничего
 * не знает про скины, геометрию катков ему передаёт вызывающий код (`GamePlay`).
 */
export type TTankWheelSpec = { cx: number; cy: number; r: number };

/**
 * Угол поворота катка (радианы) от пройденного пути при качении без
 * проскальзывания (длина дуги = путь): `distance / radius`. Чистая функция —
 * даёт одинаковый счёт и `Tank.move` (бой), и витрине `/design-system`
 * (issue #496, критерий «скорость вращения пропорциональна пройденному пути»),
 * чтобы формула не разошлась в двух местах.
 */
export function wheelRotationDelta(distance: number, wheelRadiusPx: number): number {
    return wheelRadiusPx > 0 ? distance / wheelRadiusPx : 0;
}

/**
 * Рисует катки поверх корпуса: каждый — вокруг СВОЕГО центра на угол `rotation`
 * (issue #496), позиция и радиус — доли `body` из `wheel.cx/cy/r`. Чистая
 * функция (без аллокаций — `save/restore` вокруг `drawImage`, как остальной
 * рендер движка, правило `canvas.md`), вынесена из `Tank.draw`, чтобы витрина
 * `/design-system` могла показать вращение тем же кодом, не дублируя трансформ.
 */
export function drawTankWheels(
    ctx: CanvasRenderingContext2D,
    wheelImg: HTMLImageElement | undefined,
    wheels: readonly TTankWheelSpec[],
    body: { x: number; y: number; width: number; height: number },
    rotation: number,
): void {
    if (!wheelImg) return;
    for (const wheel of wheels) {
        const cx = body.x + wheel.cx * body.width;
        const cy = body.y + wheel.cy * body.height;
        const r = wheel.r * body.width;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation);
        ctx.drawImage(wheelImg, -r, -r, r * 2, r * 2);
        ctx.restore();
    }
}

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
    private wheelImg: HTMLImageElement | undefined;
    private wheels: readonly TTankWheelSpec[];
    /** `false` — снимок `prefers-reduced-motion: reduce` на бой (issue #496): катки не крутятся. */
    private wheelRotationEnabled: boolean;
    /** Накопленный угол поворота катков (радианы) — растёт с пройденным путём в `move()`. */
    wheelRotation = 0;
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
    /**
     * Тень от светила (#545): ставит `GamePlay` из модели света боя (`computeSceneLight`)
     * после конструирования, как и скины — `Tank` сам про сид/пресет не знает. `null` —
     * тени нет (тесты/реплей без сида, день до светила).
     */
    shadow: TTankShadow = null;

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
        wheelImg?: HTMLImageElement,
        wheels: readonly TTankWheelSpec[] = [],
        wheelRotationEnabled = true,
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
        this.wheelImg = wheelImg;
        this.wheels = wheels;
        this.wheelRotationEnabled = wheelRotationEnabled;
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
            const delta = Math.abs(this.dx) > step ? direction * step : direction * this.dx;
            this.x += delta;
            // Катки крутятся по манёвру, не по прыжку/отдаче (issue #496: «при
            // манёвре») — скорость от фактически пройденного пути этого шага,
            // не от времени, иначе на паузе (rAF не идёт) они бы «доезжали» сами.
            this.updateWheelRotation(delta);
            this.dx -= direction * step;
        } else {
            this.dx = 0;
        }
        this.gunpointX = this.x + this.gunpointDeltaX;
        this.gunpointY = this.y - this.gunpointDeltaY;
    };

    private updateWheelRotation(distance: number) {
        if (!this.wheelRotationEnabled || distance === 0 || this.wheels.length === 0) return;
        // ДОПУЩЕНИЕ: у всех катков геометрии один радиус (сейчас так у classic и
        // heavy), поэтому берём радиус `wheels[0]` и крутим все катки одним углом
        // `wheelRotation`. Появится геометрия с РАЗНЫМИ радиусами — угловую
        // скорость придётся считать по-катково (у меньшего катка она больше), а
        // `drawTankWheels` — принимать угол на каток, не общий.
        const wheelRadiusPx = this.wheels[0].r * this.tankWidth;
        this.wheelRotation += wheelRotationDelta(distance, wheelRadiusPx);
    }

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

    /**
     * Тень корпуса на рельефе (#545): плоский эллипс на поверхности земли под танком,
     * смещённый по горизонтали в сторону, обратную светилу (`shadow.direction.dx`).
     * Рисуется ДО корпуса (в неповёрнутом ctx, до наклонного трансформа `slopeTank`),
     * поэтому лежит на склоне в мировых координатах, а не «висит» с корпусом. Эллипс
     * центрируется по поверхности под серединой танка — даёт гарантированные пиксели
     * контакта корпуса с рельефом (критерий #545), которых у «висящего» танка не было.
     */
    private drawShadow(ctx: CanvasRenderingContext2D, ground: Ground) {
        if (!this.shadow) return;
        const lastX = ground.heights.length - 1;
        if (lastX < 0) return;
        const centerX = Math.min(lastX, Math.max(0, floor(this.x + this.tankWidth / 2)));
        const surfaceY = this.innerHeight - ground.heights[centerX];
        const radiusX = this.tankWidth * 0.5;
        // Тонкий эллипс (~2 px в каноне, масштабируется миром) — тень, не «клякса».
        const radiusY = Math.max(2, 2 * this.scale);
        // Смещение по свету: в сторону, обратную светилу. Модуль — доля ширины танка,
        // тень «выползает» из-под корпуса, не отрываясь от него.
        const offsetX = this.shadow.direction.dx * this.tankWidth * 0.28;
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = this.shadow.color;
        ctx.ellipse(centerX + offsetX, surfaceY, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    draw(ctx: CanvasRenderingContext2D, mousePos: TCoords | null, ground: Ground) {
        this.drawShadow(ctx, ground);
        this.recalcPosition(ctx, ground);
        const body = this.bodyRect();
        if (this.tankBodyImg) {
            ctx.drawImage(this.tankBodyImg, body.x, body.y, body.width, body.height);
        }
        // Под тем же наклонным трансформом корпуса (rotateFigure выше в
        // recalcPosition), чтобы катки тоже «сидели» на склоне, не только тело.
        drawTankWheels(ctx, this.wheelImg, this.wheels, body, this.wheelRotation);
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
