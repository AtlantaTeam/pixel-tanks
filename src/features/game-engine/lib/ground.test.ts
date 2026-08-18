import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { computeTerrainHeights, type TArenaInsets } from './arena-insets';
import { Ground } from './ground';

/** Потолок кадров осадки кратера в тестах: осыпание идёт по пикселю за кадр и
 *  обязано сходиться — без границы регресс сходимости повесил бы прогон до общего
 *  таймаута vitest вместо внятного падения. */
const SETTLE_CAP_FRAMES = 200;

const WIDTH = 800;
const HEIGHT = 600;

describe('Ground.generate', () => {
    it('генерирует идентичный массив высот для одного seed', () => {
        const first = new Ground(WIDTH, HEIGHT, createSeededRandom(42));
        const second = new Ground(WIDTH, HEIGHT, createSeededRandom(42));

        expect(first.heights).toEqual(second.heights);
    });

    it('генерирует идентичный массив высот при повторной генерации с тем же seed', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(7));
        const firstHeights = [...ground.heights];

        const regenerated = new Ground(WIDTH, HEIGHT, createSeededRandom(7));

        expect(regenerated.heights).toEqual(firstHeights);
    });

    it('детерминирован для набора разных seed', () => {
        [0, 1, 42, 1234, 99999].forEach((seed) => {
            const first = new Ground(WIDTH, HEIGHT, createSeededRandom(seed));
            const second = new Ground(WIDTH, HEIGHT, createSeededRandom(seed));

            expect(first.heights).toEqual(second.heights);
        });
    });

    it('генерирует разные массивы высот для разных seed', () => {
        const first = new Ground(WIDTH, HEIGHT, createSeededRandom(1));
        const second = new Ground(WIDTH, HEIGHT, createSeededRandom(2));

        expect(first.heights).not.toEqual(second.heights);
    });

    it('даёт разные массивы для нескольких пар соседних seed', () => {
        [
            [10, 11],
            [100, 200],
            [777, 888],
        ].forEach(([seedA, seedB]) => {
            const a = new Ground(WIDTH, HEIGHT, createSeededRandom(seedA));
            const b = new Ground(WIDTH, HEIGHT, createSeededRandom(seedB));

            expect(a.heights).not.toEqual(b.heights);
        });
    });

    it('держит высоты в допустимых границах рельефа', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(2026));
        const heightMax = Math.floor(HEIGHT / 2);
        const heightMin = Math.floor(heightMax / 4);

        expect(ground.heights).toHaveLength(WIDTH);
        ground.heights.forEach((height) => {
            expect(height).toBeGreaterThanOrEqual(heightMin);
            expect(height).toBeLessThanOrEqual(heightMax);
        });
    });

    it('состоит только из целочисленных высот', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(555));

        ground.heights.forEach((height) => {
            expect(Number.isInteger(height)).toBe(true);
        });
    });
});

describe('Ground.resize', () => {
    it('не трогает RNG — поток случайных чисел после resize не смещается', () => {
        const resizedRandom = createSeededRandom(42);
        const controlRandom = createSeededRandom(42);
        const resized = new Ground(WIDTH, HEIGHT, resizedRandom);
        new Ground(WIDTH, HEIGHT, controlRandom);

        resized.resize(WIDTH * 2, HEIGHT * 2);

        expect(resizedRandom()).toBe(controlRandom());
    });

    it('сохраняет рельеф при resize в тот же размер', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(42));
        const before = [...ground.heights];

        ground.resize(WIDTH, HEIGHT);

        expect(ground.heights).toEqual(before);
    });

    it('масштабирует высоты пропорционально по вертикали', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(7));
        const before = [...ground.heights];

        ground.resize(WIDTH, HEIGHT * 2);

        expect(ground.heights).toEqual(before.map((h) => h * 2));
    });

    it('интерполирует профиль по ширине, сохраняя крайние точки', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(7));
        const before = [...ground.heights];

        ground.resize(WIDTH * 2, HEIGHT);

        expect(ground.heights).toHaveLength(WIDTH * 2);
        expect(ground.heights[0]).toBe(before[0]);
        expect(ground.heights[WIDTH * 2 - 1]).toBe(before[WIDTH - 1]);
    });

    it('сохраняет кратер (изменённый профиль) при масштабировании', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(11));
        const craterX = 400;
        ground.heights[craterX] -= 30;
        const craterBefore = ground.heights[craterX];

        ground.resize(WIDTH, HEIGHT);

        expect(ground.heights[craterX]).toBe(craterBefore);
    });

    it('после resize высоты целочисленные', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(555));

        ground.resize(637, 411);

        expect(ground.heights).toHaveLength(637);
        ground.heights.forEach((height) => {
            expect(Number.isInteger(height)).toBe(true);
        });
    });
});

describe('Ground: рельеф внутри свободной зоны (safe-зона, #454)', () => {
    const INSETS: TArenaInsets = { top: 140, bottom: 150 };

    it('явно пустые инсеты дают тот же рельеф, что и без аргумента', () => {
        const withArg = new Ground(WIDTH, HEIGHT, createSeededRandom(42), undefined, {
            top: 0,
            bottom: 0,
        });
        const withoutArg = new Ground(WIDTH, HEIGHT, createSeededRandom(42));

        expect(withArg.heights).toEqual(withoutArg.heights);
    });

    it('детерминирован по seed и при непустых инсетах', () => {
        const first = new Ground(WIDTH, HEIGHT, createSeededRandom(7), undefined, INSETS);
        const second = new Ground(WIDTH, HEIGHT, createSeededRandom(7), undefined, INSETS);

        expect(first.heights).toEqual(second.heights);
    });

    it('поднимает рельеф в зону: поверхность не под палубой и не под HUD', () => {
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(2026), undefined, INSETS);
        const zoneTopY = INSETS.top;
        const deckTopY = HEIGHT - INSETS.bottom;

        ground.heights.forEach((h) => {
            const surfaceY = HEIGHT - h;
            // Ни одна точка поверхности не уходит под палубу (ниже её верха) и не
            // залезает под HUD (выше верха зоны).
            expect(surfaceY).toBeLessThanOrEqual(deckTopY);
            expect(surfaceY).toBeGreaterThanOrEqual(zoneTopY);
        });
    });

    it('инсеты сдвигают рельеф вверх относительно поведения без safe-зоны', () => {
        const full = new Ground(WIDTH, HEIGHT, createSeededRandom(99));
        const zoned = new Ground(WIDTH, HEIGHT, createSeededRandom(99), undefined, INSETS);

        // При поднятой базовой линии низины (минимальная высота) выше, чем без зоны.
        expect(Math.min(...zoned.heights)).toBeGreaterThan(Math.min(...full.heights));
    });
});

describe('Ground.resize: перекладка рельефа в зону при смене размера канваса', () => {
    it('после ресайза с инсетами рельеф остаётся внутри полосы новой высоты', () => {
        const insets: TArenaInsets = { top: 120, bottom: 140 };
        const ground = new Ground(WIDTH, HEIGHT, createSeededRandom(7), undefined, insets);

        ground.resize(WIDTH, 500);

        const band = computeTerrainHeights(500, insets);
        ground.heights.forEach((h) => {
            // ±1 — дрейф floor при линейном переносе профиля в новую полосу.
            expect(h).toBeGreaterThanOrEqual(Math.floor(band.min) - 1);
            expect(h).toBeLessThanOrEqual(Math.ceil(band.max) + 1);
        });
    });
});

const makeLayerCtx = () => ({
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
});

const makeDestCtx = () => ({
    drawImage: vi.fn(),
});

describe('Ground: offscreen-кэш террейна (.claude/rules/canvas.md)', () => {
    let layerCtxMock: ReturnType<typeof makeLayerCtx>;
    const originalCreateElement = document.createElement.bind(document);

    beforeEach(() => {
        layerCtxMock = makeLayerCtx();
        vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
            if (tagName === 'canvas') {
                return {
                    width: 0,
                    height: 0,
                    getContext: () => layerCtxMock,
                } as unknown as HTMLCanvasElement;
            }
            return originalCreateElement(tagName);
        }) as typeof document.createElement);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('draw() строит path в offscreen-слое один раз, пока рельеф не меняется', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        const destCtx = makeDestCtx();

        ground.draw(destCtx as unknown as CanvasRenderingContext2D);
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        expect(layerCtxMock.beginPath).toHaveBeenCalledTimes(1);
        expect(destCtx.drawImage).toHaveBeenCalledTimes(3);
    });

    it('fall() снова помечает слой грязным — следующий draw() перестраивает path', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        const destCtx = makeDestCtx();
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        ground.fall(50, 10, 5);
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        expect(layerCtxMock.beginPath).toHaveBeenCalledTimes(2);
    });

    it('fallingFrom/To накрывают воронку, пока она осыпается, и гаснут после (#601)', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        const destCtx = makeDestCtx();
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        // До взрыва осадки нет — диапазон пуст, точечной перерисовке чистить нечего.
        expect(ground.fallingFrom).toBe(-1);
        expect(ground.fallingTo).toBe(-1);

        ground.fall(50, 10, 5);
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        // Воронка занимает [45 … 55] — диапазон обязан накрыть её целиком, иначе
        // край воронки осыпается в слое, но не попадает на сцену.
        expect(ground.isFalling).toBe(true);
        expect(ground.fallingFrom).toBeLessThanOrEqual(45);
        expect(ground.fallingTo).toBeGreaterThanOrEqual(55);

        // Осадка сходит на нет за конечное число кадров, и вместе с ней — диапазон.
        for (let frame = 0; frame < 200 && ground.isFalling; frame += 1) {
            ground.beginFrame();
            ground.draw(destCtx as unknown as CanvasRenderingContext2D);
        }
        expect(ground.isFalling, 'воронка не осыпалась за 200 кадров').toBe(false);
        expect(ground.fallingFrom).toBe(-1);
        expect(ground.fallingTo).toBe(-1);
    });

    it('диапазон осадки только сужается — кадр вправе брать его от прошлого кадра', () => {
        // На этом свойстве стоит порядок вызовов в `GamePlay.animate`: полоса берётся
        // ДО `ground.draw` этого кадра (иначе очистка стёрла бы уже нарисованные танки),
        // то есть диапазон прошлого кадра обязан быть надмножеством текущего.
        const ground = new Ground(100, 100, createSeededRandom(1));
        const destCtx = makeDestCtx();
        ground.fall(50, 10, 8);
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        let prevFrom = ground.fallingFrom;
        let prevTo = ground.fallingTo;
        let steps = 0;
        while (ground.isFalling && steps < 200) {
            ground.beginFrame();
            ground.draw(destCtx as unknown as CanvasRenderingContext2D);
            steps += 1;
            if (!ground.isFalling) break;
            expect(ground.fallingFrom).toBeGreaterThanOrEqual(prevFrom);
            expect(ground.fallingTo).toBeLessThanOrEqual(prevTo);
            prevFrom = ground.fallingFrom;
            prevTo = ground.fallingTo;
        }
        // Гвард от вырождения: осадка обязана занять несколько кадров, иначе цикл
        // выше не проверил ни одного перехода.
        expect(steps).toBeGreaterThan(1);
    });

    it('beginFrame() помечает слой грязным, только пока isFalling', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        const destCtx = makeDestCtx();
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        ground.beginFrame();
        ground.draw(destCtx as unknown as CanvasRenderingContext2D);

        expect(layerCtxMock.beginPath).toHaveBeenCalledTimes(1);
    });

    it('draw() с частичным диапазоном тоже переиспользует закешированный слой', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        const destCtx = makeDestCtx();

        ground.draw(destCtx as unknown as CanvasRenderingContext2D, 10, 40);
        ground.draw(destCtx as unknown as CanvasRenderingContext2D, 60, 90);

        expect(layerCtxMock.beginPath).toHaveBeenCalledTimes(1);
        expect(destCtx.drawImage).toHaveBeenCalledTimes(2);
    });

    it('тонировка (#545) заливает силуэт рельефа через source-atop по числу слоёв', () => {
        const tint = [
            { color: '#d9713e', alpha: 0.3 },
            { color: '#c900ff', alpha: 0.08 },
        ];
        const ground = new Ground(100, 100, createSeededRandom(1), undefined, undefined, tint);
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
        // По одному fillRect на слой тонировки, композит — source-atop (только песок).
        expect(layerCtxMock.fillRect).toHaveBeenCalledTimes(tint.length);
        expect(layerCtxMock.globalCompositeOperation).toBe('source-atop');
    });

    it('без тонировки (день) source-atop-заливки нет', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
        expect(layerCtxMock.fillRect).not.toHaveBeenCalled();
    });

    it('дождь (#547) затемняет столбцы воронок через source-atop, по одному fillRect на столбец', () => {
        const ground = new Ground(
            100,
            100,
            createSeededRandom(1),
            undefined,
            undefined,
            [],
            undefined,
            { darkenAlpha: 0.28, edgeSoftenPx: 1 },
        );
        // Воронка радиусом 5 в центре: столбцы 45..55 (11 штук) помечаются кратерными.
        ground.fall(50, 10, 5);
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);

        expect(layerCtxMock.fillRect).toHaveBeenCalledTimes(11);
        expect(layerCtxMock.globalCompositeOperation).toBe('source-atop');
    });

    it('затемнение воронки ограничено по вертикали глубиной ямы, не всей heightMax (#620)', () => {
        const ground = new Ground(
            100,
            100,
            createSeededRandom(1),
            undefined,
            undefined,
            [],
            undefined,
            { darkenAlpha: 0.28, edgeSoftenPx: 1 },
        );
        const heightMax = Math.floor(100 / 2);
        ground.flatten(50);
        // bulletY=70 копает ниже плоского рельефа (высота 50) — фактическая яма
        // получается заметно мельче heightMax, иначе не отличить фикс от бага.
        ground.fall(50, 70, 5);
        // Догоняем осыпание кратера до полной остановки (как реальный игровой цикл
        // делает через beginFrame() на каждом тике), чтобы взять финальную глубину.
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
        // Потолок итераций, а не `while (isFalling)` без границы: регресс, при
        // котором осадка перестанет сходиться, обязан упасть внятно и здесь, а не
        // повиснуть до общего таймаута vitest (тот же гвард, что
        // `GROUND_SETTLE_CAP_FRAMES` в VRT-спеке).
        let steps = 0;
        while (ground.isFalling && steps < SETTLE_CAP_FRAMES) {
            ground.beginFrame();
            ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
            steps += 1;
        }
        expect(ground.isFalling, 'осадка кратера не сошлась за отведённые кадры').toBe(false);
        expect(
            steps,
            'осадка обязана занять хотя бы кадр — иначе тест меряет пустоту',
        ).toBeGreaterThan(0);

        expect(layerCtxMock.fillRect.mock.calls.length).toBeGreaterThan(0);
        layerCtxMock.fillRect.mock.calls.forEach(([, y, , height]) => {
            // Старый баг: высота всегда равнялась heightMax, а верх колонны — фиксированному
            // bandTop = innerHeight - heightMax, то есть красило до низа канваса.
            expect(height).toBeLessThan(heightMax);
            expect(y).toBeGreaterThan(100 - heightMax);
            expect(y + height).toBeLessThanOrEqual(100);
        });
    });

    it('на склоне базовая высота идёт по форме склона, а не по среднему опор (ревью #620)', () => {
        const ground = new Ground(
            100,
            100,
            createSeededRandom(1),
            undefined,
            undefined,
            [],
            undefined,
            { darkenAlpha: 0.28, edgeSoftenPx: 1 },
        );
        // Ровный склон: высота растёт на 1 px за столбец — «дюна» без шума.
        ground.flatten(30, 1);
        const beforeFall = [...ground.heights];
        ground.fall(50, 40, 5);
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
        let steps = 0;
        while (ground.isFalling && steps < SETTLE_CAP_FRAMES) {
            ground.beginFrame();
            ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
            steps += 1;
        }

        // Только колонны ПОСЛЕДНЕГО кадра: мок копит вызовы всех кадров осадки, а
        // сверяем мы их с финальными высотами. Столбцов ровно столько, сколько
        // помечено кратерными (радиус 5 → 11).
        const CRATER_COLUMNS = 11;
        const bands = (layerCtxMock.fillRect.mock.calls as number[][]).slice(-CRATER_COLUMNS);
        expect(bands).toHaveLength(CRATER_COLUMNS);

        // Хвост под дном — один и тот же у всех столбцов, значит высота колонны
        // следует РЕАЛЬНОЙ глубине в каждом столбце. Со средним двух опор глубина
        // на склоне косая: у верхних по склону столбцов она завышена, у нижних
        // схлопывается в 0 (столб красится одним хвостом) — хвосты разъезжаются.
        const tails = bands.map(([x, , , height]) => height - (beforeFall[x] - ground.heights[x]));
        tails.forEach((tail, i) => {
            expect(tail, `столбец ${bands[i][0]}: хвост ${tail} против ${tails[0]} у первого`).toBe(
                tails[0],
            );
        });
        expect(tails[0], 'хвост под дном воронки обязан быть положительным').toBeGreaterThan(0);

        // И симметрия по сторонам склона: «со стороны подъёма затемнения почти нет»
        // было прямым симптомом среднего (левая сумма вдвое больше правой).
        const sumSide = (side: (x: number) => boolean) =>
            bands.filter(([x]) => side(x)).reduce((acc, [, , , h]) => acc + h, 0);
        const uphill = sumSide((x) => x > 50);
        const downhill = sumSide((x) => x < 50);
        expect(Math.abs(uphill - downhill)).toBeLessThanOrEqual(Math.max(uphill, downhill) * 0.1);
    });

    it('без осадков-дождя (нет craterStyle) воронки не затемняются', () => {
        const ground = new Ground(100, 100, createSeededRandom(1));
        ground.fall(50, 10, 5);
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
        expect(layerCtxMock.fillRect).not.toHaveBeenCalled();
    });

    it('до попадания (нет воронок) дождь ничего не затемняет', () => {
        const ground = new Ground(
            100,
            100,
            createSeededRandom(1),
            undefined,
            undefined,
            [],
            undefined,
            {
                darkenAlpha: 0.28,
                edgeSoftenPx: 1,
            },
        );
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
        expect(layerCtxMock.fillRect).not.toHaveBeenCalled();
    });

    it('подсветка кромки (#545) рисует линию по верху рельефа тоном каймы', () => {
        const ground = new Ground(
            100,
            100,
            createSeededRandom(1),
            undefined,
            undefined,
            [],
            '#ffb066',
        );
        ground.draw(makeDestCtx() as unknown as CanvasRenderingContext2D);
        // Крест-линия строит path (beginPath: рельеф + кромка) и штрихует её.
        expect(layerCtxMock.beginPath).toHaveBeenCalledTimes(2);
        expect(layerCtxMock.stroke).toHaveBeenCalledTimes(2);
    });
});
