import type { RefObject } from 'react';
import { floor, getDevicePixelRatio, toDevicePixels } from '@/shared/lib/canvas';
import { getAudioEngine } from '@/shared/lib/audio';
import type { TSeededRandom } from '@/shared/lib/random';
import type { TCoords, TWeapon } from '@/shared/model';
import { Ground } from './ground';
import { Tank } from './tank';
import { Bullet } from './bullet';
import { generateWind } from './wind';
import { calculateAimPreviewDots } from './aim-preview';

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
    /** Пунктирная линия прицела видна только во время оттяжки (тач-жест) */
    showAimPreview = false;
    private isImagesLoaded = false;
    allWeapons: TTanksWeapons;
    callbacks: TGamePlayCallbacks;
    private readonly audio = getAudioEngine();
    damageAmount = 0;
    rafTimerId: number | undefined;
    private random: TSeededRandom;
    wind = 0;
    private resizeObserver: ResizeObserver | undefined;
    private resizeRafId: number | undefined;

    constructor(
        canvasRef: RefObject<HTMLCanvasElement | null>,
        allWeapons: TTanksWeapons,
        callbacks: TGamePlayCallbacks,
        random: TSeededRandom,
    ) {
        this.random = random;
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

    // Управляется жестом «оттяни и отпусти»: показываем пунктир на время драга,
    // при скрытии форсируем fullRedraw — иначе хвост линии остаётся на песке
    // до следующей полной перерисовки (выстрел её не гарантирует сразу).
    setAimPreviewVisible = (visible: boolean) => {
        if (this.showAimPreview === visible) return;
        this.showAimPreview = visible;
        if (!visible) this.fullRedraw();
    };

    private drawAimPreview(ctx: CanvasRenderingContext2D) {
        if (!this.leftTank || !this.rightTank) return;
        const [activeTank] = this.getActiveAndTargetTanks(this.leftTank, this.rightTank);
        const dots = calculateAimPreviewDots(
            { x: activeTank.gunpointX, y: activeTank.gunpointY },
            activeTank.gunpointAngle,
            activeTank.power,
        );
        const dotSize = 3;
        ctx.fillStyle = '#ffcd75';
        for (const dot of dots) {
            ctx.fillRect(dot.x - dotSize / 2, dot.y - dotSize / 2, dotSize, dotSize);
        }
    }

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

    // Подгоняет бэкинг-стор canvas под CSS-размер и devicePixelRatio.
    // innerWidth/innerHeight — ЛОГИЧЕСКИЕ (CSS) пиксели: вся физика и рисование
    // в них, а ctx масштабируется на dpr, поэтому картинка чёткая на ретине.
    // Возвращает true, если логический размер или бэкинг-стор изменились
    // (в обоих случаях нужна перерисовка сцены).
    fit = (): boolean => {
        const canvas = this.canvasRef.current;
        if (!canvas) return false;
        const rect = canvas.getBoundingClientRect();
        const cssWidth = floor(rect.width || canvas.offsetWidth || this.innerWidth);
        const cssHeight = floor(rect.height || canvas.offsetHeight || this.innerHeight);
        const dpr = getDevicePixelRatio();
        const backingWidth = toDevicePixels(cssWidth, dpr);
        const backingHeight = toDevicePixels(cssHeight, dpr);
        // Смена только dpr (перенос окна между мониторами, зум) меняет бэкинг-стор
        // при том же CSS-размере — canvas очищается, поэтому это тоже «изменение».
        const changed =
            this.innerWidth !== cssWidth ||
            this.innerHeight !== cssHeight ||
            canvas.width !== backingWidth ||
            canvas.height !== backingHeight;

        // Присваивание canvas.width/height сбрасывает контекст (transform → identity,
        // очистка), поэтому меняем только при реальном изменении и заново ставим базу.
        if (canvas.width !== backingWidth) canvas.width = backingWidth;
        if (canvas.height !== backingHeight) canvas.height = backingHeight;
        this.innerWidth = cssWidth;
        this.innerHeight = cssHeight;
        if (this.ctx) {
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        return changed;
    };

    private observeResize = () => {
        const canvas = this.canvasRef.current;
        if (!canvas || typeof ResizeObserver === 'undefined' || this.resizeObserver) return;
        // Реагируем на resize окна и поворот телефона: коалесцируем в один rAF.
        this.resizeObserver = new ResizeObserver(() => {
            if (this.resizeRafId !== undefined) return;
            this.resizeRafId = requestAnimationFrame(() => {
                this.resizeRafId = undefined;
                this.applyResize();
            });
        });
        this.resizeObserver.observe(canvas);
    };

    private applyResize = () => {
        if (!this.ctx || !this.ground || !this.leftTank || !this.rightTank) return;
        const prevWidth = this.innerWidth;
        const prevHeight = this.innerHeight;
        if (!this.fit()) return;
        if (prevWidth !== this.innerWidth || prevHeight !== this.innerHeight) {
            this.rescaleTerrainAndTanks();
            this.rescaleBullet(prevWidth, prevHeight);
        }
        // Даже при смене только dpr бэкинг-стор пересоздан (canvas очищен) —
        // перерисовка нужна безусловно.
        this.fullRedraw();
    };

    // Пересчитывает террейн под новый размер (Ground.resize — без RNG, форма и
    // детерминизм сохраняются) и переставляет танки пропорционально.
    private rescaleTerrainAndTanks = () => {
        if (!this.leftTank || !this.rightTank || !this.ground) return;
        this.ground.resize(this.innerWidth, this.innerHeight);
        const leftTankX = floor(this.innerWidth / 4);
        const rightTankX = floor((this.innerWidth * 3) / 4);
        for (const [tank, x] of [
            [this.leftTank, leftTankX],
            [this.rightTank, rightTankX],
        ] as const) {
            tank.innerWidth = this.innerWidth;
            tank.innerHeight = this.innerHeight;
            tank.x = x;
            tank.y = this.innerHeight - this.ground.heights[x];
            tank.dx = 0;
            tank.dy = 0;
        }
    };

    // Снаряд в полёте переносится в новые координаты пропорционально: сброс терял бы
    // уже израсходованное оружие и подвешивал ход на игроке (ревью PR #41).
    private rescaleBullet = (prevWidth: number, prevHeight: number) => {
        if (!this.bullet) return;
        this.bullet.x = floor((this.bullet.x * this.innerWidth) / prevWidth);
        this.bullet.y = floor((this.bullet.y * this.innerHeight) / prevHeight);
        this.bullet.lastX = this.bullet.x;
        this.bullet.lastY = this.bullet.y;
        this.bullet.innerWidth = this.innerWidth;
        this.bullet.innerHeight = this.innerHeight;
    };

    initPaint = () => {
        const canvas = this.canvasRef.current;
        if (canvas) {
            this.ctx = canvas.getContext('2d');
        }
        this.fit();
        const { leftTank, leftGunpoint, sand, rightTank, rightGunpoint } = GamePlay.images;
        const { leftTankWeapons, rightTankWeapons } = this.allWeapons;
        this.ground = new Ground(this.innerWidth, this.innerHeight, this.random, sand);
        this.wind = generateWind(this.random);
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
        this.animate();
        this.fullRedraw();
        this.observeResize();
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
        // Линия прицела может выходить далеко за паддинг вокруг танка — точечная
        // перерисовка её не очистит, поэтому во время оттяжки берём fullRedraw.
        if (this.showAimPreview) {
            this.fullRedraw();
            return;
        }
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
        if (this.showAimPreview) this.drawAimPreview(this.ctx);
    }

    private redrawGroundUnderTanks(tanks: Tank[]) {
        tanks.forEach((tank) => {
            const padding = 50;
            if (this.ctx && this.ground) {
                this.ctx.clearRect(
                    tank.x - padding,
                    0,
                    tank.tankWidth + padding * 2,
                    this.innerHeight,
                );
                this.ground.draw(this.ctx, tank.x - padding, tank.x + tank.tankWidth + padding);
            }
        });
    }

    moveBullet = (ctx: CanvasRenderingContext2D) => {
        if (!this.isFireMode || !this.bullet) return;
        this.bullet.move();
        if (this.bullet.isHit(ctx)) {
            if (this.bullet.isTankHit && this.bullet.hittedTank) {
                void this.audio.playSfx('hit');
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
                void this.audio.playSfx('miss');
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
            for (let currentAngle = startAngle; stopCondition(currentAngle); currentAngle += step) {
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
                        this.random() *
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
            this.wind,
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
        this.bullet = new Bullet(
            this.innerWidth,
            this.innerHeight,
            ground,
            activeTank,
            targetTank,
            this.wind,
        );
        void this.audio.playSfx('fire');
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
        if (this.resizeRafId !== undefined) {
            cancelAnimationFrame(this.resizeRafId);
            this.resizeRafId = undefined;
        }
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
    }
}
