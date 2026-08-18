import { describe, expect, it } from 'vitest';
import { computeLightDirection } from './scene-light';
import { pickCelestialGeometry } from './sky-celestial';
import type { TSkyPresetId } from './sky-preset';
import {
    TANK_DECOR_REDRAW_PADDING,
    TANK_SHADOW_OFFSET_X_FRAC,
    TANK_SHADOW_RADIUS_X_FRAC,
    tankRedrawPaddingX,
    tankShadowGeometry,
    tankShadowOverhangX,
} from './tank-shadow';

/** Канон мира: `WORLD_UNITS.tankWidth` = 60 при `scale === 1`. */
const TANK_WIDTH = 60;

/**
 * Все пресеты неба. `satisfies` вместо голого массива: добавят четвёртый пресет —
 * список здесь не покраснеет сам, но `tsc` покраснеет на любом `Record<TSkyPresetId, …>`
 * рядом, и расхождение всплывёт сразу, а не через зелёный vacuous-тест.
 */
const SKY_PRESET_IDS = ['day', 'sunset', 'night'] as const satisfies readonly TSkyPresetId[];

describe('tankShadowGeometry — геометрия эллипса тени', () => {
    it('светило справа (dx<0) смещает тень влево от центра корпуса', () => {
        const { centerX } = tankShadowGeometry({
            centerX: 100,
            tankWidth: TANK_WIDTH,
            scale: 1,
            lightDx: -0.6,
        });
        expect(centerX).toBeLessThan(100);
    });

    it('светило слева (dx>0) смещает тень вправо от центра корпуса', () => {
        const { centerX } = tankShadowGeometry({
            centerX: 100,
            tankWidth: TANK_WIDTH,
            scale: 1,
            lightDx: 0.6,
        });
        expect(centerX).toBeGreaterThan(100);
    });

    it('светило в зените (dx=0) держит тень ровно под корпусом', () => {
        const { centerX } = tankShadowGeometry({
            centerX: 100,
            tankWidth: TANK_WIDTH,
            scale: 1,
            lightDx: 0,
        });
        expect(centerX).toBe(100);
    });

    it('полуширина — доля ширины корпуса, полувысота не меньше канонных 2 px', () => {
        const big = tankShadowGeometry({
            centerX: 0,
            tankWidth: 90,
            scale: 1.5,
            lightDx: 0,
        });
        expect(big.radiusX).toBeCloseTo(90 * TANK_SHADOW_RADIUS_X_FRAC, 6);
        expect(big.radiusY).toBeCloseTo(3, 6);

        const small = tankShadowGeometry({
            centerX: 0,
            tankWidth: 30,
            scale: 0.5,
            lightDx: 0,
        });
        // На минимальном масштабе тень не вырождается в линию: пол 2 px.
        expect(small.radiusY).toBe(2);
    });

    it('высота светила (dy) на геометрию НЕ влияет — регресс #571 не возвращается', () => {
        // #571 привязал полуширину к dy, и на закате (dy→0) тень вырождалась в чёрную
        // полосу шириной с треть экрана. Что высоты нет в подписи — держит `tsc`, и
        // отдельный assert этого не докажет: прежняя версия теста сравнивала чистую
        // функцию саму с собой на одном и том же входе и оставалась зелёной при любой
        // реализации, включая ту, что снова притянет dy.
        //
        // Проверяем то, что подпись доказать не может: на РЕАЛЬНЫХ светилах трёх
        // пресетов (у них разная высота — день высоко, закат у горизонта) геометрия
        // определяется только горизонтальной компонентой.
        const perPreset = SKY_PRESET_IDS.map((presetId) => {
            const light = computeLightDirection(pickCelestialGeometry('shadow-seed', presetId));
            return { presetId, light };
        });

        // Гвард от вырождения: пресеты обязаны реально различаться высотой светила,
        // иначе «везде одинаково» ничего не значит.
        const heights = new Set(perPreset.map(({ light }) => light.dy.toFixed(4)));
        expect(heights.size, `пресеты дали одинаковый dy: ${[...heights].join(', ')}`).toBe(
            SKY_PRESET_IDS.length,
        );

        // Один и тот же dx на разных пресетах — одна и та же геометрия, несмотря на dy.
        const sharedDx = -0.9;
        const reference = tankShadowGeometry({
            centerX: 100,
            tankWidth: TANK_WIDTH,
            scale: 1,
            lightDx: sharedDx,
        });
        for (const { presetId, light } of perPreset) {
            const withPresetDx = tankShadowGeometry({
                centerX: 100,
                tankWidth: TANK_WIDTH,
                scale: 1,
                lightDx: light.dx,
            });
            expect(withPresetDx.radiusX, `radiusX пресета ${presetId} зависит от высоты`).toBe(
                reference.radiusX,
            );
            expect(withPresetDx.radiusY, `radiusY пресета ${presetId} зависит от высоты`).toBe(
                reference.radiusY,
            );
            expect(withPresetDx.radiusX).toBeLessThanOrEqual(TANK_WIDTH);
        }
    });

    it('габарит тени не выходит за разумные пределы корпуса при любом наклоне света', () => {
        // Критерий #580: на любом пресете неба (свет от вертикали до горизонта)
        // тень остаётся тенью корпуса, а не полосой.
        for (const lightDx of [-1, -0.5, 0, 0.5, 1]) {
            const { centerX, radiusX } = tankShadowGeometry({
                centerX: TANK_WIDTH / 2,
                tankWidth: TANK_WIDTH,
                scale: 1,
                lightDx,
            });
            const left = centerX - radiusX;
            const right = centerX + radiusX;
            expect(right - left).toBeLessThanOrEqual(TANK_WIDTH * 1.5);
            expect(left).toBeGreaterThanOrEqual(-TANK_WIDTH);
            expect(right).toBeLessThanOrEqual(TANK_WIDTH * 2);
        }
    });
});

describe('tankShadowOverhangX — вылет тени за габарит корпуса', () => {
    it('считается по худшему направлению света, а не по текущему', () => {
        const overhang = tankShadowOverhangX(TANK_WIDTH);
        const expected = TANK_WIDTH * (TANK_SHADOW_RADIUS_X_FRAC + TANK_SHADOW_OFFSET_X_FRAC - 0.5);
        expect(overhang).toBeCloseTo(expected, 6);
    });

    it('растёт вместе с ШИРИНОЙ КОРПУСА — единственным, от чего зависит', () => {
        // Корпус уже отмасштабирован миром, поэтому вылет — функция одной ширины.
        // Проверяем обе половины утверждения: шире корпус — больше вылет...
        expect(tankShadowOverhangX(90)).toBeGreaterThan(tankShadowOverhangX(30));
        // ...и линейно, а не как попало: вдвое шире корпус — вдвое дальше вылет.
        expect(tankShadowOverhangX(120)).toBeCloseTo(tankShadowOverhangX(60) * 2, 6);
    });

    it('никогда не отрицателен — тень внутри корпуса даёт нулевой вылет', () => {
        expect(tankShadowOverhangX(0)).toBe(0);
    });
});

describe('tankRedrawPaddingX — зона очистки следует за габаритом тени (#580)', () => {
    /**
     * Ядро задачи: до #580 зона очистки была магической константой `padding = 50`,
     * жившей независимо от радиусов тени, — отсюда след за танком и накопление
     * альфы у взрывов. Тест держит связь: зона обязана покрывать вылет тени
     * ЛЮБОГО размера, а не только сегодняшнего.
     */
    it('покрывает вылет тени на всём диапазоне масштаба мира', () => {
        for (const scale of [0.5, 0.75, 1, 1.25, 1.5]) {
            const tankWidth = 60 * scale;
            expect(tankRedrawPaddingX(tankWidth)).toBeGreaterThanOrEqual(
                tankShadowOverhangX(tankWidth),
            );
        }
    });

    it('покрывает вылет и у гипотетически огромной тени — связь, а не совпадение чисел', () => {
        // Корпус шириной 1000 px даёт вылет 280 px — вчетверо больше исторического
        // паддинга декора. Зона обязана поехать за тенью, а не остаться на 50.
        const huge = tankRedrawPaddingX(1000);
        expect(huge).toBeGreaterThanOrEqual(tankShadowOverhangX(1000));
        expect(huge).toBeGreaterThan(TANK_DECOR_REDRAW_PADDING);
    });

    it('не опускается ниже исторического запаса на ствол и мачту флажка', () => {
        expect(tankRedrawPaddingX(30)).toBeGreaterThanOrEqual(TANK_DECOR_REDRAW_PADDING);
    });

    it('целое число пикселей — зона очистки не дробится на субпиксели', () => {
        expect(Number.isInteger(tankRedrawPaddingX(90))).toBe(true);
        expect(Number.isInteger(tankRedrawPaddingX(1000))).toBe(true);
    });
});
