import { floor } from '@/shared/lib/canvas';
import { Ground } from './ground';
import { Tank } from './tank';

export class Bullet {
    static readonly label = 'Снаряд';

    radius: number;
    private mass: number;
    x: number;
    lastX = 0;
    y: number;
    lastY = 0;
    power: number;
    dx: number;
    private dy: number;
    gravity: number;
    elasticity: number;
    private wind: number;
    explosionRadius: number;
    private explosionMaxRadius: number;
    private color: string;
    innerWidth: number;
    innerHeight: number;
    isFinished = false;
    isTankHit = false;
    private ground: Ground;
    targetTank: Tank;
    private activeTank: Tank;
    hittedTank: Tank | undefined;

    constructor(
        innerWidth: number,
        innerHeight: number,
        ground: Ground,
        activeTank: Tank,
        targetTank: Tank,
        wind = 0,
    ) {
        this.activeTank = activeTank;
        this.targetTank = targetTank;
        this.radius = 2;
        this.mass = this.radius;
        const { x, y } = activeTank.calcBulletStartPos();
        this.x = x;
        this.y = y;
        this.power = activeTank.power;
        this.dx = floor(Math.cos(activeTank.gunpointAngle) * this.power);
        this.dy = floor(Math.sin(activeTank.gunpointAngle) * this.power);
        this.gravity = 0.1;
        this.elasticity = 1;
        this.wind = wind;
        this.explosionRadius = 0;
        this.explosionMaxRadius = 50;
        this.color = '#000000';
        this.innerWidth = innerWidth;
        this.innerHeight = innerHeight;
        this.ground = ground;
    }

    move() {
        if (this.y + this.radius < this.innerHeight) {
            this.dy += this.gravity;
        }
        this.dx += this.wind;
        this.x = floor(this.x + this.dx);
        this.y = floor(this.y + this.dy);
    }

    isHit = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
        if (this.isTankHit) return true;

        this.checkTankHit(ctx, this.targetTank);

        if (this.activeTank.canHarmYourself) {
            this.checkTankHit(ctx, this.activeTank);
        }

        if (!this.isTankHit) {
            if (
                this.x + this.radius > this.innerWidth ||
                this.x - this.radius < 0 ||
                this.y + this.radius > this.innerHeight ||
                this.y - this.radius < 0
            ) {
                this.dy *= this.elasticity;

                if (this.x + this.radius > this.innerWidth) {
                    this.x = this.innerWidth - this.radius;
                    this.dx *= -1;
                } else if (this.x - this.radius < 0) {
                    this.x = this.radius;
                    this.dx *= -1;
                } else if (this.y > this.innerHeight) {
                    return true;
                }
            }

            if (this.innerHeight - this.y - this.radius <= this.ground.heights[floor(this.x)]) {
                return true;
            }
        } else {
            return true;
        }

        return false;
    };

    checkTankHit = (
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        tank: Tank,
    ) => {
        ctx.save();
        if (tank.currentTransformer) {
            ctx.setTransform(tank.currentTransformer);
        }
        if (ctx.isPointInPath(tank.tankHitArea, this.x, this.y)) {
            this.isTankHit = true;
            this.hittedTank = tank;
        }
        ctx.restore();
    };

    drawExplosion = (ctx: CanvasRenderingContext2D) => {
        this.dx = 0;
        this.dy = 0;
        this.radius = 0;

        const gradient = ctx.createRadialGradient(
            this.x,
            this.y,
            this.explosionRadius / 10,
            this.x,
            this.y,
            this.explosionRadius + this.explosionRadius / 2,
        );

        gradient.addColorStop(0, '#f37575ff');
        gradient.addColorStop(0.3, '#ff0000ee');
        gradient.addColorStop(1, '#571a1a55');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.explosionRadius, 0, 2 * Math.PI, true);
        ctx.fill();
        ctx.closePath();
        this.explosionRadius += 1;
        if (this.explosionRadius >= this.explosionMaxRadius) {
            this.ground.fall(floor(this.x), floor(this.y), this.explosionRadius);
            this.isFinished = true;
            this.explosionRadius = 0;
        }

        return true;
    };

    isPositionChanged() {
        return this.lastX !== this.x || this.lastY !== this.y;
    }

    draw(ctx: CanvasRenderingContext2D) {
        if (this.isPositionChanged()) {
            ctx.clearRect(this.lastX, this.lastY, this.radius * 2, this.radius * 2);

            if (ctx.fillStyle !== this.color) {
                ctx.fillStyle = this.color;
            }
            ctx.fillRect(this.x, this.y, this.radius * 2, this.radius * 2);
            this.lastX = this.x;
            this.lastY = this.y;
        }
    }
}
