import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { TTankWheelSpec as TSkinWheelSpec } from '@/entities/tank-skins';
import { createSeededRandom } from '@/shared/lib/random';
import { EWeaponKind, type TWeapon } from '@/shared/model';
import { ENGINE_COLORS } from './engine-palette';
import { Ground } from './ground';
import { drawTankWheels, Tank, wheelRotationDelta, type TTankWheelSpec } from './tank';
import {
    WIND_FLAG_LENGTH,
    WIND_FLAG_MIN_SCALE,
    WIND_FLAG_PENNANT,
    WIND_FLAG_POLE_WIDTH,
    windFlagRotationRad,
} from './wind-flag';
import { WORLD_SCALE_MIN, WORLD_UNITS } from './world-scale';

// Пин структурного совпадения `TTankWheelSpec` движка (`tank.ts`) и реестра
// скинов (`entities/tank-skins`). `Tank` намеренно НЕ импортирует тип из
// entities (развязка «движок не знает про скины», docblock в `tank.ts`), но
// формы обязаны совпадать — `GamePlay` кормит движок `geometry.wheels`. Разъедутся
// (кто-то добавит поле в одну из копий) — тип-ассерт не скомпилируется в
// `npm run typecheck`, а не всплывёт молчаливым структурным дрейфом.
type MutuallyAssignable<A, B> = A extends B ? (B extends A ? true : never) : never;
const _wheelSpecMatch: MutuallyAssignable<TTankWheelSpec, TSkinWheelSpec> = true;
void _wheelSpecMatch;

const WIDTH = 800;
const HEIGHT = 600;
const WEAPON: TWeapon = { id: 0, name: 'Фугас', kind: EWeaponKind.HighExplosive };

// happy-dom не предоставляет Path2D. Заглушка хранит прямоугольник хит-зоны и его
// возвращает — ровно то, что читает Bullet.checkTankHit и проверяет этот тест.
class Path2DStub {
    rectArgs: [number, number, number, number] | null = null;
    rect(x: number, y: number, w: number, h: number) {
        this.rectArgs = [x, y, w, h];
    }
    addPath() {}
}

beforeAll(() => {
    if (typeof globalThis.Path2D === 'undefined') {
        vi.stubGlobal('Path2D', Path2DStub);
    }
    if (typeof globalThis.DOMMatrix === 'undefined') {
        // rotateFigure строит DOMMatrix для наклона корпуса; в этом тесте наклон не
        // важен (сверяем только прямоугольник тела), поэтому достаточно заглушки с
        // цепочкой self-методов, возвращающих себя.
        class DOMMatrixStub {
            a = 1;
            b = 0;
            c = 0;
            d = 1;
            e = 0;
            f = 0;
            translateSelf() {
                return this;
            }
            rotateSelf() {
                return this;
            }
        }
        vi.stubGlobal('DOMMatrix', DOMMatrixStub);
    }
});

/** ctx-заглушка, записывающая аргументы drawImage корпуса (первый вызов). */
const makeRecordingCtx = () => {
    const drawImageCalls: number[][] = [];
    const ctx = {
        save: () => undefined,
        restore: () => undefined,
        translate: () => undefined,
        rotate: () => undefined,
        setTransform: () => undefined,
        drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
            drawImageCalls.push([x, y, w, h]);
        },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, drawImageCalls };
};

/** Плоский рельеф, чтобы наклон корпуса не влиял на позицию тела. */
const flatGround = () => {
    const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(1));
    ground.heights = new Array<number>(WIDTH).fill(100);
    return ground;
};

// Изображение корпуса, чтобы сработала ветка ctx.drawImage в Tank.draw.
const bodyImg = {} as HTMLImageElement;

describe('Tank — масштаб мира (issue #455)', () => {
    it('без scale (дефолт) размеры равны канону прежних констант', () => {
        const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON]);
        expect(tank.scale).toBe(1);
        expect(tank.tankWidth).toBe(WORLD_UNITS.tankWidth);
        expect(tank.tankHeight).toBe(WORLD_UNITS.tankHeight);
    });

    it.each([0.5, 0.768, 1.28, 1.5])('scale=%p масштабирует корпус и ствол', (scale) => {
        const tank = new Tank(
            200,
            HEIGHT - 100,
            WIDTH,
            HEIGHT,
            0,
            [WEAPON],
            undefined,
            undefined,
            scale,
        );
        expect(tank.tankWidth).toBeCloseTo(WORLD_UNITS.tankWidth * scale, 6);
        expect(tank.tankHeight).toBeCloseTo(WORLD_UNITS.tankHeight * scale, 6);
    });

    it('bodyRect масштабируется коэффициентом: тело поднято на tankHeight', () => {
        const scale = 0.5;
        const y = HEIGHT - 100;
        const tank = new Tank(200, y, WIDTH, HEIGHT, 0, [WEAPON], undefined, undefined, scale);
        const rect = tank.bodyRect();
        expect(rect.width).toBeCloseTo(WORLD_UNITS.tankWidth * scale, 6);
        expect(rect.height).toBeCloseTo(WORLD_UNITS.tankHeight * scale, 6);
        // Верх тела — на tankHeight выше базовой линии (низ тела на y).
        expect(rect.y).toBe(Math.floor(y - tank.tankHeight));
    });

    it('setScale пересчитывает размеры и якорь ствола', () => {
        const tank = new Tank(
            200,
            HEIGHT - 100,
            WIDTH,
            HEIGHT,
            0,
            [WEAPON],
            undefined,
            undefined,
            1,
        );
        tank.setScale(0.5);
        expect(tank.scale).toBe(0.5);
        expect(tank.tankWidth).toBeCloseTo(WORLD_UNITS.tankWidth * 0.5, 6);
        // Якорь ствола = x + масштабированная дельта.
        expect(tank.gunpointX).toBeCloseTo(tank.x + WORLD_UNITS.gunpointDeltaX * 0.5, 6);
    });

    it('хит-зона совпадает с отрисовкой корпуса при не единичном масштабе (критерий #455)', () => {
        const scale = 0.5;
        const tank = new Tank(
            200,
            HEIGHT - 100,
            WIDTH,
            HEIGHT,
            0,
            [WEAPON],
            bodyImg,
            undefined,
            scale,
        );
        const { ctx, drawImageCalls } = makeRecordingCtx();

        tank.draw(ctx, null, flatGround());

        // Первый drawImage — корпус танка. Его прямоугольник обязан совпасть с
        // прямоугольником, записанным в хит-зону (tankHitArea), иначе попадание
        // засчитывалось бы не там, где видно касание.
        const hitArea = tank.tankHitArea as unknown as Path2DStub;
        expect(drawImageCalls.length).toBeGreaterThan(0);
        expect(hitArea.rectArgs).not.toBeNull();
        expect(hitArea.rectArgs).toEqual(drawImageCalls[0]);
    });
});

describe('wheelRotationDelta — угол поворота катка от пройденного пути (issue #496)', () => {
    it('качение без проскальзывания: угол = путь / радиус', () => {
        expect(wheelRotationDelta(20, 10)).toBe(2);
    });

    it('обратное направление даёт отрицательный угол', () => {
        expect(wheelRotationDelta(-20, 10)).toBe(-2);
    });

    it('нулевой/отрицательный радиус не делит на ноль — угол 0', () => {
        expect(wheelRotationDelta(20, 0)).toBe(0);
        expect(wheelRotationDelta(20, -5)).toBe(0);
    });
});

describe('drawTankWheels — раскладка катков (issue #496)', () => {
    // ctx-заглушка, записывающая translate (центр катка) и drawImage (радиус).
    const makeWheelCtx = () => {
        const translates: number[][] = [];
        const draws: number[][] = [];
        const ctx = {
            save: () => undefined,
            restore: () => undefined,
            translate: (x: number, y: number) => translates.push([x, y]),
            rotate: () => undefined,
            drawImage: (_img: unknown, x: number, y: number, w: number, h: number) =>
                draws.push([x, y, w, h]),
        } as unknown as CanvasRenderingContext2D;
        return { ctx, translates, draws };
    };

    const wheelImg = {} as HTMLImageElement;
    const body = { x: 100, y: 40, width: 60, height: 30 };
    const wheels: TTankWheelSpec[] = [
        { cx: 0.25, cy: 0.9, r: 0.1 },
        { cx: 0.5, cy: 0.9, r: 0.1 },
        { cx: 0.75, cy: 0.9, r: 0.1 },
    ];

    it('рисует ровно по одному катку на каждую позицию геометрии', () => {
        const { ctx, draws } = makeWheelCtx();
        drawTankWheels(ctx, wheelImg, wheels, body, 0);
        expect(draws).toHaveLength(wheels.length);
    });

    it('центр = body + доля (translate), радиус = r*width, спрайт от -r до +r', () => {
        const { ctx, translates, draws } = makeWheelCtx();
        drawTankWheels(ctx, wheelImg, wheels, body, 0);
        wheels.forEach((wheel, i) => {
            const cx = body.x + wheel.cx * body.width;
            const cy = body.y + wheel.cy * body.height;
            const r = wheel.r * body.width;
            expect(translates[i]).toEqual([cx, cy]);
            // drawImage рисуется от центра (после translate), поэтому [-r,-r,2r,2r].
            expect(draws[i]).toEqual([-r, -r, r * 2, r * 2]);
        });
    });

    it('без картинки катка ничего не рисует (гард на неподгруженный спрайт)', () => {
        const { ctx, draws } = makeWheelCtx();
        drawTankWheels(ctx, undefined, wheels, body, 0);
        expect(draws).toHaveLength(0);
    });
});

describe('Tank — вращение катков (issue #496)', () => {
    // Один каток в центре тела, радиус — 1/6 ширины корпуса: при tankWidth=60
    // (scale=1) это 10px, удобное круглое число для проверки угла.
    const WHEELS: TTankWheelSpec[] = [{ cx: 0.5, cy: 0.9, r: 1 / 6 }];

    const makeMovingTank = (dx: number, wheelRotationEnabled = true) => {
        const tank = new Tank(
            200,
            HEIGHT - 100,
            WIDTH,
            HEIGHT,
            0,
            [WEAPON],
            undefined,
            undefined,
            1,
            undefined,
            WHEELS,
            wheelRotationEnabled,
        );
        tank.dx = dx;
        return tank;
    };

    it('на месте (dx=0) катки не крутятся', () => {
        // move() напрямую здесь не зовём: боевой код вызывает его только когда
        // `this.dx` истинно (см. `recalcPosition` — `if (this.dx && !this.dy)`),
        // поэтому проверяем реальный путь простоя, а не голый move() с dx=0.
        const tank = makeMovingTank(0);
        const ground = flatGround();
        const { ctx } = makeRecordingCtx();
        tank.recalcPosition(ctx, ground);
        tank.recalcPosition(ctx, ground);
        expect(tank.wheelRotation).toBe(0);
    });

    it('скорость вращения пропорциональна пройденному пути, не числу кадров', () => {
        const tank = makeMovingTank(50);
        for (let i = 0; i < 5; i++) tank.move();
        // Каждый вызов move() при dx=50 (шаг 2 < |dx|) продвигает танк на 2px —
        // за 5 вызовов пройдено 10px. Радиус катка — 10px (60 * 1/6) → угол 1 рад.
        expect(tank.wheelRotation).toBeCloseTo(1, 6);

        const tankDoubleFrames = makeMovingTank(50);
        for (let i = 0; i < 10; i++) tankDoubleFrames.move();
        // В два раза больше вызовов move() при том же шаге — путь и угол тоже
        // удваиваются: считает путь, а не количество кадров/вызовов.
        expect(tankDoubleFrames.wheelRotation).toBeCloseTo(2, 6);
    });

    it('направление вращения совпадает с направлением движения', () => {
        const right = makeMovingTank(50);
        const left = makeMovingTank(-50);
        for (let i = 0; i < 5; i++) {
            right.move();
            left.move();
        }
        expect(right.wheelRotation).toBeGreaterThan(0);
        expect(left.wheelRotation).toBeLessThan(0);
        expect(left.wheelRotation).toBeCloseTo(-right.wheelRotation, 6);
    });

    it('prefers-reduced-motion (wheelRotationEnabled=false) отключает вращение', () => {
        const tank = makeMovingTank(50, false);
        for (let i = 0; i < 5; i++) tank.move();
        expect(tank.wheelRotation).toBe(0);
    });
});

/**
 * ctx-заглушка, записывающая вызовы `ellipse` (центр тени) поверх методов
 * `makeRecordingCtx` — draw() после тени идёт обычным путём корпуса.
 */
const makeShadowCtx = () => {
    const ellipseCalls: number[][] = [];
    const base = makeRecordingCtx().ctx as unknown as Record<string, unknown>;
    const ctx = {
        ...base,
        beginPath: () => undefined,
        fill: () => undefined,
        ellipse: (
            x: number,
            y: number,
            rx: number,
            ry: number,
            rot: number,
            s: number,
            e: number,
        ) => {
            ellipseCalls.push([x, y, rx, ry, rot, s, e]);
        },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, ellipseCalls };
};

describe('Tank.draw — тень от светила (#545)', () => {
    const centerX = (tank: Tank) => tank.x + tank.tankWidth / 2;

    it('без shadow (дефолт) эллипс тени не рисуется', () => {
        const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON], bodyImg);
        const { ctx, ellipseCalls } = makeShadowCtx();
        tank.draw(ctx, null, flatGround());
        expect(ellipseCalls).toHaveLength(0);
    });

    it('светило справа (dx<0) → тень смещена влево от центра корпуса', () => {
        const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON], bodyImg);
        tank.shadow = { direction: { dx: -0.6, dy: 0.8 }, color: 'rgba(0,0,0,0.3)' };
        const { ctx, ellipseCalls } = makeShadowCtx();
        tank.draw(ctx, null, flatGround());
        expect(ellipseCalls).toHaveLength(1);
        // Центр эллипса левее середины корпуса — знак совпадает со знаком dx (влево).
        expect(ellipseCalls[0][0]).toBeLessThan(centerX(tank));
    });

    it('светило слева (dx>0) → тень смещена вправо от центра корпуса', () => {
        const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON], bodyImg);
        tank.shadow = { direction: { dx: 0.6, dy: 0.8 }, color: 'rgba(0,0,0,0.3)' };
        const { ctx, ellipseCalls } = makeShadowCtx();
        tank.draw(ctx, null, flatGround());
        expect(ellipseCalls).toHaveLength(1);
        expect(ellipseCalls[0][0]).toBeGreaterThan(centerX(tank));
    });

    it('тень лежит на поверхности рельефа под корпусом (пиксель контакта)', () => {
        const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON], bodyImg);
        tank.shadow = { direction: { dx: -0.6, dy: 0.8 }, color: 'rgba(0,0,0,0.3)' };
        const { ctx, ellipseCalls } = makeShadowCtx();
        // Плоский рельеф высотой 100 → поверхность на HEIGHT-100.
        tank.draw(ctx, null, flatGround());
        expect(ellipseCalls[0][1]).toBe(HEIGHT - 100);
    });
});

/** Запись одной операции рисования вместе с цветом/толщиной на момент вызова. */
type TDrawOp = {
    op: 'fillRect' | 'fill' | 'stroke' | 'translate' | 'rotate' | 'vertex';
    args: number[];
    color: string;
    lineWidth: number;
};

/**
 * ctx-заглушка для флажка ветра (#579): пишет упорядоченный журнал операций с
 * цветом на момент вызова. Порядок важен — по нему проверяется, что древко
 * рисуется ПОВЕРХ полотнища, а вершины контура идут после поворота на угол ветра.
 */
class FlagCtxStub {
    fillStyle = '';
    strokeStyle = '';
    lineWidth = 0;
    lineJoin = 'miter';
    ops: TDrawOp[] = [];

    private push(op: TDrawOp['op'], args: number[]) {
        this.ops.push({
            op,
            args,
            color: op === 'stroke' ? this.strokeStyle : this.fillStyle,
            lineWidth: this.lineWidth,
        });
    }

    save() {}
    restore() {}
    setTransform() {}
    beginPath() {}
    closePath() {}
    drawImage() {}
    ellipse() {}
    translate(x: number, y: number) {
        this.push('translate', [x, y]);
    }
    rotate(angle: number) {
        this.push('rotate', [angle]);
    }
    moveTo(x: number, y: number) {
        this.push('vertex', [x, y]);
    }
    lineTo(x: number, y: number) {
        this.push('vertex', [x, y]);
    }
    fillRect(x: number, y: number, w: number, h: number) {
        this.push('fillRect', [x, y, w, h]);
    }
    fill() {
        this.push('fill', []);
    }
    stroke() {
        this.push('stroke', []);
    }
}

/** Относительная яркость hex-цвета (0..1) — грубая, для сравнения «темнее/светлее». */
const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('Tank.draw — флажок ветра: вымпел, а не прямоугольник (#579)', () => {
    /** Слабый ветер вправо — рабочий кейс большинства проверок формы. */
    const WIND = 0.004;
    const WIND_ROTATION = windFlagRotationRad(WIND);

    /** `wind === null` — флажка нет вовсе (чужой танк), иначе ставим его моделью. */
    const drawFlag = (scale = 1, wind: number | null = WIND) => {
        const tank = new Tank(
            200,
            HEIGHT - 100,
            WIDTH,
            HEIGHT,
            0,
            [WEAPON],
            bodyImg,
            undefined,
            scale,
        );
        if (wind !== null) tank.setWindFlag(wind);
        const stub = new FlagCtxStub();
        tank.draw(stub as unknown as CanvasRenderingContext2D, null, flatGround());
        return { tank, ops: stub.ops };
    };

    /** Индекс поворота полотнища — граница между древком/корпусом и контуром вымпела. */
    const rotateIndexOf = (ops: TDrawOp[], rotation: number) =>
        ops.findIndex((o) => o.op === 'rotate' && o.args[0] === rotation);
    const flagRotateIndex = (ops: TDrawOp[]) => rotateIndexOf(ops, WIND_ROTATION);

    it('без угла (чужой танк) флажок не рисуется вовсе', () => {
        const { ops } = drawFlag(1, null);
        expect(ops.filter((o) => o.op === 'vertex')).toHaveLength(0);
    });

    it('полотнище — замкнутый контур из вершин канона, а не fillRect', () => {
        const { ops } = drawFlag();
        const vertices = ops.filter((o) => o.op === 'vertex');
        expect(vertices).toHaveLength(WIND_FLAG_PENNANT.length);
        expect(vertices.length).toBeGreaterThan(4);
    });

    it('наклон полотнища берётся из windFlagRotationRad (модель #550 не тронута)', () => {
        const { ops } = drawFlag();
        expect(flagRotateIndex(ops)).toBeGreaterThanOrEqual(0);
        const vertices = ops.filter((o) => o.op === 'vertex');
        // Вершины идут ПОСЛЕ поворота — контур рисуется в повёрнутой системе,
        // а не пересчитывается руками мимо модели.
        expect(ops.indexOf(vertices[0])).toBeGreaterThan(flagRotateIndex(ops));
    });

    it('полотнище зеркалится по направлению ветра — при обоих знаках висит под осью', () => {
        // Через `setWindFlag`, а не заданием угла руками: сторона провисания выводится
        // из ЗНАКА ветра (ревью #579), и тест обязан идти тем же путём, что бой.
        const verticesOf = (wind: number) => {
            const tank = new Tank(200, HEIGHT - 100, WIDTH, HEIGHT, 0, [WEAPON], bodyImg);
            tank.setWindFlag(wind);
            const stub = new FlagCtxStub();
            tank.draw(stub as unknown as CanvasRenderingContext2D, null, flatGround());
            return stub.ops.filter((o) => o.op === 'vertex').map((o) => o.args);
        };
        const right = verticesOf(0.01);
        const left = verticesOf(-0.01);
        expect(right).toHaveLength(WIND_FLAG_PENNANT.length);
        right.forEach(([x, y], i) => {
            expect(left[i][0]).toBeCloseTo(x, 6);
            expect(left[i][1]).toBeCloseTo(-y, 6);
        });
    });

    it('цвет полотнища не равен ENGINE_COLORS.accent (не кусок UI на корпусе)', () => {
        const { ops } = drawFlag();
        const fill = ops.find((o) => o.op === 'fill');
        expect(fill).toBeDefined();
        expect(fill?.color).not.toBe(ENGINE_COLORS.accent);
    });

    it('полотнище отделено от фона тёмной обводкой', () => {
        const { ops } = drawFlag();
        const fill = ops.find((o) => o.op === 'fill');
        const stroke = ops.find((o) => o.op === 'stroke');
        expect(stroke).toBeDefined();
        expect(stroke?.lineWidth).toBeGreaterThan(0);
        expect(luminance(String(stroke?.color))).toBeLessThan(luminance(String(fill?.color)));
        expect(luminance(String(stroke?.color))).toBeLessThan(0.2);
    });

    it('древко различимо: не тоньше 2 px даже на минимальном масштабе мира', () => {
        const { ops } = drawFlag(WORLD_SCALE_MIN);
        const rotateAt = flagRotateIndex(ops);
        // Прямоугольники ПОСЛЕ контура полотнища — древко (тёмный контур + ядро).
        const poleRects = ops.filter((o, i) => o.op === 'fillRect' && i > rotateAt);
        expect(poleRects.length).toBeGreaterThan(0);
        for (const rect of poleRects) {
            expect(rect.args[2]).toBeGreaterThanOrEqual(WIND_FLAG_POLE_WIDTH);
        }
    });

    it('на узкой арене флажок не ужимается ниже пола читаемости', () => {
        const { ops } = drawFlag(WORLD_SCALE_MIN);
        const fly = ops
            .filter((o) => o.op === 'vertex')
            .reduce((max, o) => Math.max(max, Math.abs(o.args[0])), 0);
        // Честная пропорция дала бы WIND_FLAG_LENGTH * 0.5; пол держит 0.8.
        expect(fly).toBeCloseTo(WIND_FLAG_LENGTH * WIND_FLAG_MIN_SCALE, 6);
    });

    it('на широкой арене флажок масштабируется миром, а не залипает на поле', () => {
        const scale = 1.5;
        const { ops } = drawFlag(scale);
        const fly = ops
            .filter((o) => o.op === 'vertex')
            .reduce((max, o) => Math.max(max, Math.abs(o.args[0])), 0);
        expect(fly).toBeCloseTo(WIND_FLAG_LENGTH * scale, 6);
    });

    it('древко рисуется поверх полотнища — не прячется под ним в штиль', () => {
        const { ops } = drawFlag();
        const strokeAt = ops.findIndex((o) => o.op === 'stroke');
        const poleAt = ops.map((o) => o.op).lastIndexOf('fillRect');
        expect(strokeAt).toBeGreaterThanOrEqual(0);
        expect(poleAt).toBeGreaterThan(strokeAt);
    });

    // Узкая арена — худший случай: там работает пол масштаба флажка, и мачта могла бы
    // оказаться короче полотнища относительно корпуса. Ветер РОВНО нулевой (ревью
    // #579): именно штиль — худшая поза, вымпел висит вдоль мачты во всю длину, и
    // проверять её кейсом со слабым ветром было подменой. Нижний край берём из
    // НАРИСОВАННЫХ вершин, повёрнутых записанным `ctx.rotate`, а не из констант —
    // иначе ассерт сводится к `LENGTH < POLE_HEIGHT`, уже запиненному в `wind-flag.test.ts`.
    it.each([WORLD_SCALE_MIN, 1, 1.28, 1.5])(
        'в штиль (scale=%p) конец вымпела не достаёт до силуэта корпуса даже обводкой',
        (scale) => {
            const restRotation = windFlagRotationRad(0);
            const { tank, ops } = drawFlag(scale, 0);
            // Вершина мачты — последний translate ПЕРЕД поворотом на угол ветра: до
            // него в журнале лежат translate'ы наклона корпуса и разворота ствола.
            const rotateAt = rotateIndexOf(ops, restRotation);
            expect(rotateAt).toBeGreaterThanOrEqual(0);
            const pivot = ops
                .slice(0, rotateAt)
                .filter((o) => o.op === 'translate')
                .at(-1);
            expect(pivot).toBeDefined();
            const pivotY = Number(pivot?.args[1]);

            const vertices = ops.filter((o) => o.op === 'vertex');
            expect(vertices).toHaveLength(WIND_FLAG_PENNANT.length);
            const sin = Math.sin(restRotation);
            const cos = Math.cos(restRotation);
            const clothTipY = Math.max(
                ...vertices.map(({ args: [x, y] }) => pivotY + x * sin + y * cos),
            );
            // Обводка рисуется ПО ЦЕНТРУ контура — половина её ширины торчит наружу
            // и съедает зазор до корпуса (ревью #579).
            const outline = ops.find((o) => o.op === 'stroke')?.lineWidth ?? 0;
            expect(outline).toBeGreaterThan(0);

            expect(clothTipY + outline / 2).toBeLessThan(tank.bodyRect().y);
        },
    );
});
