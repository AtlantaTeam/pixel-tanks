import { floor } from '@/shared/lib/canvas';
import { EWeaponKind } from '@/shared/model';
import { advanceProjectile, BULLET_GRAVITY } from './bullet-physics';
import { explosionRedrawRange, type TExplosionRedrawRange } from './explosion-area';
import { Ground } from './ground';
import { Tank } from './tank';
import { WORLD_UNITS } from './world-scale';
import {
    paintExplosionFocus,
    WEAPON_SPECS,
    type TWeaponFocus,
    type TWeaponSpec,
} from './weapon-specs';

export class Bullet {
    radius: number;
    private mass: number;
    x: number;
    lastX = 0;
    y: number;
    lastY = 0;
    power: number;
    dx: number;
    // Публичное (не private): предпросмотр траектории (`fillTrajectoryPreview`) и
    // тест «одно место правды» шагают копию вектора {x,y,dx,dy} тем же
    // `advanceProjectile`, что и полёт — структурному типу нужен доступ к dy.
    dy: number;
    gravity: number;
    elasticity: number;
    private wind: number;
    explosionRadius: number;
    /** Базовый радиус взрыва (`WORLD_UNITS.explosionMaxRadius · scale`) — очаги считаются в его долях. */
    private baseExplosionRadius: number;
    /** Посчитанная полоса взрыва и вход, на котором она посчитана (см. геттер). */
    private redrawRangeCache?: TExplosionRedrawRange;
    private redrawRangeCacheX = NaN;
    private redrawRangeCacheRadius = NaN;
    /**
     * Тип оружия (issue #483): числа взрыва (стопы градиента, рост, кратер, очаги)
     * читаются из спеки. Дефолт — фугас (замороженный дефолт движка), поэтому
     * снаряд без явной спеки ведёт себя ровно как до задачи. Спека — общий на все
     * снаряды типа объект по ссылке (не утяжеляет `virtualFire` бота).
     */
    readonly spec: TWeaponSpec;
    /**
     * Индекс текущего очага взрыва (кластер отыгрывает три подряд). Явный индекс
     * вместо перегруженного `explosionRadius === 0` (ловушка #483): иначе
     * многоочаговый кластер раздал бы урон и звук трижды.
     */
    focusIndex = 0;
    /**
     * Снаряд детонировал: разовая раздача урона/звука/slow-mo идёт по этому флагу,
     * а не по `explosionRadius === 0` (который сбрасывается на каждой смене очага).
     */
    detonated = false;
    /**
     * Очаг только что сменился — `game-play` заберёт (частицы+тряска на новый очаг,
     * принудительный `fullRedraw` для кластера). Сбрасывается забором.
     */
    focusAdvanced = false;
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
        spec: TWeaponSpec = WEAPON_SPECS[EWeaponKind.HighExplosive],
    ) {
        this.activeTank = activeTank;
        this.targetTank = targetTank;
        this.spec = spec;
        // Радиус снаряда и взрыва масштабируются вместе с телом танка (масштаб мира,
        // #455): снаряд берёт коэффициент у стрелявшего танка. scale === 1 — канон
        // прежних констант (радиус 2, взрыв 50). Хит-детект по земле и стенам, а также
        // радиус кратера (`ground.fall`) идут в этих же масштабированных величинах.
        const { scale } = activeTank;
        this.radius = WORLD_UNITS.bulletRadius * scale;
        this.mass = this.radius;
        const { x, y } = activeTank.calcBulletStartPos();
        this.x = x;
        this.y = y;
        this.power = activeTank.power;
        this.dx = floor(Math.cos(activeTank.gunpointAngle) * this.power);
        this.dy = floor(Math.sin(activeTank.gunpointAngle) * this.power);
        this.gravity = BULLET_GRAVITY;
        this.elasticity = 1;
        this.wind = wind;
        this.explosionRadius = 0;
        this.baseExplosionRadius = WORLD_UNITS.explosionMaxRadius * scale;
        this.color = spec.bulletColor ?? '#000000';
        this.innerWidth = innerWidth;
        this.innerHeight = innerHeight;
        this.ground = ground;
    }

    /**
     * Пересчитывает радиус снаряда и взрыва под новый масштаб мира (issue #455).
     * Зовётся ресайзом/поворотом (`GamePlay.rescaleBullet`), когда ширина арены (а с
     * ней `scale`) изменилась во время полёта: без этого корпус танка получал бы новый
     * размер, а снаряд и радиус кратера оставались бы прежними — визуальный разрыв.
     * На реплей не влияет: там размер зафиксирован записью (`fixedLogicalSize`), ресайза
     * нет. Радиус взрыва во время самого взрыва не трогаем (`drawExplosion` ведёт свой
     * `explosionRadius` от нуля к максимуму) — меняем только базовый радиус очагов.
     */
    setScale(scale: number) {
        this.radius = WORLD_UNITS.bulletRadius * scale;
        this.mass = this.radius;
        this.baseExplosionRadius = WORLD_UNITS.explosionMaxRadius * scale;
    }

    /** Центр текущего очага по X: точка попадания плюс смещение очага (кластер).
     *
     *  Клэмп индекса — не перестраховка: после последнего очага `focusIndex` равен
     *  длине списка (это и есть признак `isFinished`), и чтение геттера в тот момент
     *  дало бы `undefined.dxFactor`. Сейчас не падает лишь потому, что `moveBullet`
     *  сбрасывает снаряд тем же кадром — то есть держится на порядке вызовов, а не на
     *  инварианте. Любой новый вызов после финала ронял бы кадр. */
    get explosionCenterX(): number {
        return this.x + this.currentFocus.dxFactor * this.baseExplosionRadius;
    }

    /** Текущий очаг с прижатым к границам индексом (см. `explosionCenterX`). */
    private get currentFocus(): TWeaponFocus {
        const foci = this.spec.foci;
        return foci[Math.min(this.focusIndex, foci.length - 1)];
    }

    /** Центр текущего очага по Y (очаги смещены только по X; глубина кратера — отдельно). */
    get explosionCenterY(): number {
        return this.y;
    }

    /**
     * Полоса сцены, которую занимает взрыв этого снаряда (issue #582): её чистит и
     * перерисовывает `GamePlay.explosionAreaRedraw` — одним диапазоном на всё.
     * Почему полоса одна и почему статична — в шапке `explosion-area.ts`.
     *
     * Геттер зовётся каждый кадр взрыва, а внутри аллоцирует объект и прогоняет
     * габарит по всем очагам — `canvas.md` просит не аллоцировать в кадре. Поэтому
     * результат кешируется, а ключ кеша — САМ ВХОД (`x` и базовый радиус; спека у
     * снаряда неизменна). Ключ, а не флаг `detonated`: `x` двигает не только `move()`,
     * его прямо присваивает `GamePlay.rescaleBullet` при ресайзе, и кеш, сброшенный
     * «где-то рядом» (в `setScale` строкой ниже), держался бы на порядке двух строк в
     * другом файле — невидимое условие, которое не сторожит ни тест, ни тип
     * (ревью #601). Сверка двух чисел дешевле пересчёта и не зависит ни от чего.
     */
    get explosionRedrawRange(): TExplosionRedrawRange {
        if (
            !this.redrawRangeCache ||
            this.redrawRangeCacheX !== this.x ||
            this.redrawRangeCacheRadius !== this.baseExplosionRadius
        ) {
            this.redrawRangeCacheX = this.x;
            this.redrawRangeCacheRadius = this.baseExplosionRadius;
            this.redrawRangeCache = explosionRedrawRange({
                hitX: this.x,
                baseRadius: this.baseExplosionRadius,
                spec: this.spec,
            });
        }
        return this.redrawRangeCache;
    }

    /** Максимальный радиус текущего очага (доля базового радиуса взрыва).
     *
     *  Через тот же `currentFocus`, что и `explosionCenterX`: оба геттера читаются из
     *  одного `draw()`, и клэмп только в одном из них не спасал ни от чего — падение
     *  просто переезжало строкой ниже. */
    private get focusMaxRadius(): number {
        return this.currentFocus.radiusFactor * this.baseExplosionRadius;
    }

    /** Забор флага смены очага: возвращает true один раз на каждый новый очаг. */
    consumeFocusAdvanced(): boolean {
        if (!this.focusAdvanced) return false;
        this.focusAdvanced = false;
        return true;
    }

    move() {
        // После детонации снаряд НЕПОДВИЖЕН, и это не косметика. `GamePlay.moveBullet`
        // зовёт `move()` безусловно каждый кадр, а `drawExplosion` обнуляет `dx/dy` уже
        // после него — значит на каждом кадре взрыва успевал отработать шаг физики:
        // `v.dx += wind; v.x = (v.x + v.dx) | 0`. Усечение к нулю превращает даже
        // `wind = -0.007` в сдвиг на 1 px за кадр, и полоса очистки (она считается от
        // `this.x`) уезжала из-под нарисованного прошлым кадром: правый край отступал
        // раньше, чем стирал вспышку. Замер: старт x=400, 50 кадров взрыва → x=350.
        //
        // Заморозка меняет и ИСХОД: воронка ложится в точку попадания, а не там, куда
        // снаряд успел уползти (замер на main: 156 px при ветре −0.02). Для записанных
        // реплеев это ретроактивная правка физики — разбор в докблоке `TReplay`.
        if (this.detonated) return;
        // Единый шаг физики с предпросмотром прицела (`advanceProjectile`, #475).
        // Гейт гравитации у нижней стены сохранён прежним: снаряд не притягивается,
        // когда его низ уже за полом поля.
        advanceProjectile(this, this.wind, this.y + this.radius < this.innerHeight, this.gravity);
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

                // Верхняя стена отбивает снаряд так же, как боковые (#264): без
                // этого снаряд с большой силой уходил за верх поля. Проверяется
                // отдельным `if` (не в else-цепочке по x), чтобы угловое попадание
                // одновременно в боковую и верхнюю границу отбило обе.
                if (this.y - this.radius < 0) {
                    this.y = this.radius;
                    this.dy *= -1;
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

    /**
     * Отыгрывает один кадр взрыва текущего очага: растущий круг радиальным
     * градиентом (стопы и палитра из спеки). Дорос до максимума очага — кратер
     * (`ground.fall`) и переход к следующему очагу; очаги кончились — `isFinished`.
     * Один конечный автомат на все типы: различия — только числа спеки.
     *
     * Ничего не рисуется за пределами `explosionRadius` (ловушка #483): ударная
     * волна мощного заряда — обод РОВНО по фронту (`r = explosionRadius`), без колец
     * и ореолов впереди. Радиус кратера (`craterRadiusFactor`) и его глубина
     * (`craterYOffsetFactor`) идут через `floor` — дробный радиус ломает `ground.fall`.
     */
    drawExplosion = (ctx: CanvasRenderingContext2D) => {
        this.dx = 0;
        this.dy = 0;
        this.radius = 0;

        const cx = this.explosionCenterX;
        const cy = this.explosionCenterY;
        const { colors, growthPerFrame, craterRadiusFactor, craterYOffsetFactor } = this.spec;

        // Единый примитив кадра взрыва (общий с витриной): градиент до фронта плюс
        // обод ударной волны РОВНО по фронту, ничего впереди него (ловушка #483).
        paintExplosionFocus(ctx, cx, cy, this.explosionRadius, colors, this.spec.silhouette);

        this.explosionRadius += growthPerFrame;
        if (this.explosionRadius >= this.focusMaxRadius) {
            const craterRadius = floor(craterRadiusFactor * this.explosionRadius);
            const craterY = floor(cy + craterYOffsetFactor * this.explosionRadius);
            this.ground.fall(floor(cx), craterY, craterRadius);
            this.explosionRadius = 0;
            this.focusIndex += 1;
            if (this.focusIndex >= this.spec.foci.length) {
                this.isFinished = true;
            } else {
                // Следующий очаг стартует после `fall` предыдущего — `game-play`
                // заберёт (частицы/тряска на очаг + принудительный fullRedraw).
                this.focusAdvanced = true;
            }
        }

        return true;
    };

    isPositionChanged() {
        return this.lastX !== this.x || this.lastY !== this.y;
    }

    draw(ctx: CanvasRenderingContext2D) {
        if (this.isPositionChanged()) {
            // Спрайт центрирован по x/y (issue #569) — та же конвенция, что и у
            // физики (отскоки, хит-детект) и следа (`BulletTrail.draw`): без
            // смещения на half след выходил из левого верхнего угла квадрата.
            const size = this.radius * 2 * this.spec.bulletSizeFactor;
            const half = size / 2;
            ctx.clearRect(this.lastX - half, this.lastY - half, size, size);

            if (ctx.fillStyle !== this.color) {
                ctx.fillStyle = this.color;
            }
            ctx.fillRect(this.x - half, this.y - half, size, size);
            this.lastX = this.x;
            this.lastY = this.y;
        }
    }
}
