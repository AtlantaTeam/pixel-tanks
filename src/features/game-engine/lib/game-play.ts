import type { RefObject } from 'react';
import { floor } from '@/shared/lib/canvas';
import type { TCoords, TWeapon } from '@/shared/model';
import { Ground } from './ground';
import { Tank } from './tank';
import { Bullet } from './bullet';

export type TTanksWeapons = {
    leftTankWeapons: TWeapon[];
    rightTankWeapons: TWeapon[];
};

export type TGameMode = 'idle' | 'fire' | 'angle' | 'move';

export type TGamePlayCallbacks = {
    onPointsCalc: (params: { hittedIsLeft: boolean; leftActive: boolean; power: number }) => void;
    onGameOverCheck: (params: { leftWeapons: number; rightWeapons: number }) => void;
    onMovesChange: (delta: number) => void;
    onPowerChange: (delta: number) => void;
};

const GAME_ASSET_PATHS = {
    leftTank: '/game/left-tank.svg',
    rightTank: '/game/right-tank.svg',
    leftGunpoint: '/game/gunpoint.svg',
    rightGunpoint: '/game/gunpoint.svg',
    sand: '/game/sand.jpg',
};

const SOUND_PATHS = {
    fire: '/game/fire.wav',
    hit: '/game/explosion-hit.wav',
    miss: '/game/explosion-miss.wav',
};

export class GamePlay {
    private prevTimestamp = 0;
    ctx: CanvasRenderingContext2D | null | undefined;
    canvasRef: RefObject<HTMLCanvasElement | null>;
    static images: { [p: string]: HTMLImageElement } = {};
    innerWidth: number;
    innerHeight: number;
    mousePos: TCoords | null;
    maxGameDifficulty = 5;
    gameDifficulty = 1;
    ground: Ground | undefined;
    leftTank: Tank | undefined;
    rightTank: Tank | undefined;
    bullet: Bullet | undefined;
    isFireMode = true;
    isAngleMode = false;
    isMoveMode = false;
    private isImagesLoaded = false;
    allWeapons: TTanksWeapons;
    callbacks: TGamePlayCallbacks;
    fireSoundEl: HTMLAudioElement | undefined;
    explosionMissSoundEl: HTMLAudioElement | undefined;
    explosionHitSoundEl: HTMLAudioElement | undefined;
    damageAmount = 0;
    rafTimerId: number | undefined;
    isSoundOn = true;

    constructor(
        canvasRef: RefObject<HTMLCanvasElement | null>,
        allWeapons: TTanksWeapons,
        callbacks: TGamePlayCallbacks,
    ) {
        this.canvasRef = canvasRef;
        this.mousePos = null;
        this.allWeapons = allWeapons;
        this.callbacks = callbacks;
        const rect = canvasRef.current?.getBoundingClientRect() ?? { width: 1000, height: 700 };
        this.innerWidth = rect.width;
        this.innerHeight = rect.height;
    }

    changeTankPosition = (delta: number) => {
        if (!this.leftTank || !this.rightTank || !this.leftTank.isActive) return;
        this.activateMode('move');
        const [activeTank] = this.getActiveAndTargetTanks(this.leftTank, this.rightTank);
        activeTank.dx = delta;
        this.callbacks.onMovesChange(-1);
    };

    changeTankPower = (delta: number) => {
        if (!this.leftTank || !this.rightTank || !this.leftTank.isActive) return;
        const [activeTank] = this.getActiveAndTargetTanks(this.leftTank, this.rightTank);
        if (
            activeTank.power + delta >= activeTank.powerMin &&
            activeTank.power + delta <= activeTank.powerMax
        ) {
            this.callbacks.onPowerChange(delta);
        }
    };

    loadImages = () => {
        if (this.ctx) {
            this.animate();
            return;
        }
        const entries = Object.entries(GAME_ASSET_PATHS);
        let loaded = 0;
        entries.forEach(([name, src]) => {
            const img = new Image();
            img.onload = () => {
                loaded += 1;
                if (loaded === entries.length) {
                    this.isImagesLoaded = true;
                    this.initPaint();
                }
            };
            img.src = src;
            GamePlay.images[name] = img;
        });
    };

    initPaint = () => {
        const canvas = this.canvasRef.current;
        if (canvas) {
            this.ctx = canvas.getContext('2d');
            this.innerWidth = canvas.width;
            this.innerHeight = canvas.height;
        }
        const { leftTank, leftGunpoint, sand, rightTank, rightGunpoint } = GamePlay.images;
        const { leftTankWeapons, rightTankWeapons } = this.allWeapons;
        this.ground = new Ground(this.innerWidth, this.innerHeight, sand);
        const leftTankX = floor(this.innerWidth / 4);
        const leftTankY = this.innerHeight - this.ground.heights[leftTankX];
        this.leftTank = new Tank(
            leftTankX,
            leftTankY,
            this.innerWidth,
            this.innerHeight,
            0,
            leftTankWeapons,
            leftTank,
            leftGunpoint,
        );
        this.leftTank.isActive = true;

        const rightTankX = floor((this.innerWidth * 3) / 4);
        const rightTankY = this.innerHeight - this.ground.heights[rightTankX];
        this.rightTank = new Tank(
            rightTankX,
            rightTankY,
            this.innerWidth,
            this.innerHeight,
            Math.PI,
            rightTankWeapons,
            rightTank,
            rightGunpoint,
        );
        if (this.ctx) {
            this.ground.draw(this.ctx);
        }
        this.fireSoundEl = new Audio(SOUND_PATHS.fire);
        this.explosionMissSoundEl = new Audio(SOUND_PATHS.miss);
        this.explosionHitSoundEl = new Audio(SOUND_PATHS.hit);
        this.animate();
        this.fullRedraw();
    };

    getActiveAndTargetTanks = (t1: Tank, t2: Tank) => (t1.isActive ? [t1, t2] : [t2, t1]);

    changeActiveTank = () => {
        if (this.leftTank && this.rightTank) {
            [this.leftTank.isActive, this.rightTank.isActive] = this.leftTank.isActive
                ? [false, true]
                : [true, false];
            this.fullRedraw();
        }
    };

    private checkGameOver = () => {
        if (!this.leftTank || !this.rightTank) return;
        this.callbacks.onGameOverCheck({
            leftWeapons: this.leftTank.weapons.length,
            rightWeapons: this.rightTank.weapons.length,
        });
    };

    animate = () => {
        this.rafTimerId = requestAnimationFrame(this.animate);
        const now = performance.now();
        this.checkGameOver();
        if (
            now - this.prevTimestamp < 15 ||
            !this.ctx ||
            !this.leftTank ||
            !this.rightTank ||
            !this.ground ||
            this.isIdleMode()
        ) {
            return;
        }

        this.prevTimestamp = now;
        if (
            (this.isFireMode && (!this.bullet || this.bullet.explosionRadius)) ||
            this.ground.isFalling
        ) {
            if (this.bullet) {
                this.explosionAreaRedraw(this.bullet);
                this.tankAreaRedraw([this.leftTank, this.rightTank]);
            } else {
                this.fullRedraw();
            }
        } else if (!this.bullet) {
            this.tankAreaRedraw([this.leftTank, this.rightTank]);
        }

        this.isAngleMode = false;
        if (this.isMoveMode && !this.leftTank.dx) {
            this.isMoveMode = false;
        }
        if (
            this.isFireMode &&
            !this.bullet &&
            !this.ground.isFalling &&
            !this.leftTank.dy &&
            !this.rightTank.dy
        ) {
            if (this.rightTank.isActive) {
                this.rightTank.isActive = false;
                this.botAiming();
                if (this.rightTank.isReadyToFire) {
                    this.tankAreaRedraw([this.leftTank, this.rightTank]);
                    this.botFire();
                }
            } else {
                this.activateMode('idle');
            }
        }

        this.moveBullet(this.ctx);
    };

    private tankAreaRedraw(tanks: Tank[]) {
        this.redrawGroundUnderTanks(tanks);
        tanks.forEach((tank) => {
            if (this.ctx && this.ground) {
                tank.draw(this.ctx, this.mousePos, this.ground);
            }
        });
    }

    private explosionAreaRedraw(bullet: Bullet) {
        const padding = 5;
        if (this.ctx && this.ground) {
            this.ctx.clearRect(
                bullet.x - bullet.explosionRadius - padding,
                0,
                bullet.explosionRadius * 2 + padding * 2,
                this.innerHeight,
            );
            this.ground.draw(
                this.ctx,
                bullet.x - bullet.explosionRadius - padding,
                bullet.x + bullet.explosionRadius * 2 + padding,
            );
        }
    }

    fullRedraw() {
        if (!this.ctx || !this.leftTank || !this.rightTank || !this.ground) return;
        this.ctx.clearRect(0, 0, this.innerWidth, this.innerHeight);
        this.ground.draw(this.ctx);
        this.leftTank.draw(this.ctx, this.mousePos, this.ground);
        this.rightTank.draw(this.ctx, this.mousePos, this.ground);
    }

    private redrawGroundUnderTanks(tanks: Tank[]) {
        tanks.forEach((tank) => {
            const padding = 50;
            if (this.ctx && this.ground) {
                this.ctx.clearRect(tank.x - padding, 0, tank.tankWidth + padding * 2, this.innerHeight);
                this.ground.draw(this.ctx, tank.x - padding, tank.x + tank.tankWidth + padding);
            }
        });
    }

    moveBullet = (ctx: CanvasRenderingContext2D) => {
        if (!this.isFireMode || !this.bullet) return;
        this.bullet.move();
        if (this.bullet.isHit(ctx)) {
            if (this.bullet.isTankHit && this.bullet.hittedTank) {
                this.playSound(this.explosionHitSoundEl);
                this.bullet.hittedTank.jumpOnHit(
                    this.bullet.power,
                    this.bullet.gravity,
                    this.bullet.dx,
                );
                this.callbacks.onPointsCalc({
                    hittedIsLeft: this.bullet.hittedTank === this.leftTank,
                    leftActive: !!this.leftTank?.isActive,
                    power: this.bullet.power,
                });
                this.damageAmount += this.bullet.power;
            } else {
                this.playSound(this.explosionMissSoundEl);
            }
            this.bullet.drawExplosion(ctx);
        }

        if (!this.bullet.isFinished) {
            this.bullet?.draw(ctx);
            return;
        }
        this.damageAmount = 0;
        this.bullet = undefined;
        this.changeActiveTank();
    };

    private playSound(audio: HTMLAudioElement | undefined) {
        if (!this.isSoundOn || !audio) return;
        audio.currentTime = 0;
        audio.play().catch(() => {
            // browser blocks autoplay until user interaction — игнорируем
        });
    }

    botFire = () => {
        if (!this.leftTank || !this.rightTank || !this.ground) return;
        const weapon = this.rightTank.weapons[0];
        if (!weapon) return;
        this.fire(this.rightTank, this.leftTank, this.ground, weapon);
        this.rightTank.isReadyToFire = false;
    };

    botAiming = () => {
        if (!this.leftTank || !this.rightTank || !this.ground) return;
        this.mousePos = null;
        const angleStep = 0.01;
        let startAngle = (3 * Math.PI) / 2;
        const startPower = 2;
        const [step, stopCondition] =
            this.leftTank.x < this.rightTank.x
                ? [-angleStep, (curAngle: number) => curAngle > Math.PI]
                : [angleStep, (curAngle: number) => curAngle < 2 * Math.PI];

        const isOverMissing = (hitX: number, tank: Tank) => {
            const isFireMissLeft = step < 0 && hitX < tank.x;
            const isFireMissRight = step > 0 && hitX > tank.x + tank.tankWidth;
            return isFireMissLeft || isFireMissRight;
        };

        for (let curPower = startPower; curPower < 18; curPower += 1) {
            for (
                let currentAngle = startAngle;
                stopCondition(currentAngle);
                currentAngle += step
            ) {
                this.rightTank.canHarmYourself = false;
                const { hitX, isTankHit } = this.virtualFire(currentAngle, curPower);

                if (isTankHit || isOverMissing(hitX, this.leftTank)) {
                    if (!isTankHit) {
                        if (
                            !this.rightTank.closestToHit ||
                            Math.abs(hitX - this.leftTank.x) < this.rightTank.closestToHit.minDiff
                        ) {
                            const count = this.rightTank.closestToHit?.count || 0;
                            this.rightTank.closestToHit = {
                                angle: currentAngle,
                                power: curPower,
                                minDiff: Math.abs(hitX - this.leftTank.x),
                                count,
                            };
                        }
                        startAngle = currentAngle - 2 * step;
                        break;
                    }
                    this.rightTank.gunpointAngle +=
                        Math.random() *
                        (this.maxGameDifficulty - this.gameDifficulty) *
                        (step / 10);
                    this.rightTank.isReadyToFire = true;
                    this.rightTank.canHarmYourself = true;
                    this.rightTank.closestToHit = null;
                    return;
                }
            }
        }
        if (this.rightTank.closestToHit) {
            this.rightTank.gunpointAngle = this.rightTank.closestToHit.angle;
            this.rightTank.power = this.rightTank.closestToHit.power;
            const delta = this.rightTank.x > this.innerWidth / 2 ? -10 : 10;
            this.rightTank.x += this.rightTank.closestToHit.count > 1 ? delta : 0;
            this.rightTank.closestToHit.count += 1;
        }
        this.rightTank.isReadyToFire = true;
        this.rightTank.canHarmYourself = true;
    };

    virtualFire(angle: number, power: number): { hitX: number; isTankHit: boolean } {
        if (!this.ctx || !this.leftTank || !this.rightTank || !this.ground) {
            return { hitX: 0, isTankHit: false };
        }
        this.rightTank.gunpointAngle = angle;
        this.rightTank.power = power;
        const virtualBullet = new Bullet(
            this.innerWidth,
            this.innerHeight,
            this.ground,
            this.rightTank,
            this.leftTank,
        );
        virtualBullet.move();
        while (!virtualBullet.isHit(this.ctx)) {
            virtualBullet.move();
        }
        return { hitX: virtualBullet.x, isTankHit: virtualBullet.isTankHit };
    }

    onFire = (weaponType: TWeapon) => {
        if (!this.leftTank || !this.rightTank || !this.ground || !weaponType) return;
        this.fire(this.leftTank, this.rightTank, this.ground, weaponType);
    };

    fire = (activeTank: Tank, targetTank: Tank, ground: Ground, weaponType: TWeapon) => {
        this.activateMode('fire');
        this.bullet = new Bullet(this.innerWidth, this.innerHeight, ground, activeTank, targetTank);
        this.playSound(this.fireSoundEl);
        activeTank.fire(weaponType);
    };

    activateMode(mode: TGameMode) {
        switch (mode) {
            case 'fire':
                this.isFireMode = true;
                this.isAngleMode = false;
                this.isMoveMode = false;
                break;
            case 'angle':
                if (!this.isFireMode) {
                    this.isAngleMode = true;
                    this.isMoveMode = false;
                }
                break;
            case 'move':
                if (!this.isFireMode) {
                    this.isMoveMode = true;
                    this.isAngleMode = false;
                }
                break;
            case 'idle':
            default:
                this.isFireMode = false;
                this.isAngleMode = false;
                this.isMoveMode = false;
        }
    }

    isIdleMode() {
        return !this.isFireMode && !this.isAngleMode && !this.isMoveMode;
    }

    destroy() {
        if (this.rafTimerId !== undefined) {
            cancelAnimationFrame(this.rafTimerId);
            this.rafTimerId = undefined;
        }
    }
}
