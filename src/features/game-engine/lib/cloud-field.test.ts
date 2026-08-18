import { describe, expect, it } from 'vitest';
import {
    buildCloudField,
    cloudCount,
    cloudPlane,
    CLOUD_COUNT_MAX,
    CLOUD_COUNT_MIN,
    CLOUD_HAZE_MIN,
    CLOUD_SCALE_MAX,
    CLOUD_SCALE_MIN,
    CLOUD_SPEED_MAX,
    CLOUD_SPEED_MIN,
    CLOUD_SQUASH_MIN,
    cloudSpriteWidth,
    windFactor,
    Y_MAX,
    Y_MIN,
} from './cloud-field';
import { MOUNTAIN_HORIZON_FRAC } from './sky-horizon';
import { computeWorldScale, WORLD_UNITS } from './world-scale';
import { MAX_WIND } from './wind';

describe('cloudCount — плотность от ширины', () => {
    it('шире экран — больше облаков (шаг из замера одобренного кадра)', () => {
        expect(cloudCount(390)).toBeLessThan(cloudCount(1280));
    });

    it('на 1280 их около четырёх — как в live-desktop.png', () => {
        expect(cloudCount(1280)).toBe(4);
    });

    it('границы держат поле осмысленным на краях', () => {
        expect(cloudCount(120)).toBe(CLOUD_COUNT_MIN);
        expect(cloudCount(99999)).toBe(CLOUD_COUNT_MAX);
    });

    it('битая ширина не роняет поле в ноль облаков', () => {
        expect(cloudCount(Number.NaN)).toBe(CLOUD_COUNT_MIN);
        expect(cloudCount(-10)).toBe(CLOUD_COUNT_MIN);
    });
});

describe('cloudSpriteWidth — размер из масштаба мира, а не доли ширины (#572)', () => {
    it('база = мировая единица × общий масштаб мира — та же геометрия, что у танка', () => {
        for (const width of [390, 768, 1280, 1920, 2560]) {
            expect(cloudSpriteWidth(width)).toBeCloseTo(
                WORLD_UNITS.cloudWidth * computeWorldScale(width),
            );
        }
    });

    it('на 1920 и 2560 облако одного размера — масштаб мира упёрся в потолок', () => {
        // Раньше доля ширины (0.15) упиралась в свой потолок на другой ширине, и
        // пропорция «облако к танку» гуляла: на 24″ крупно, на 32″ приемлемо (#572).
        expect(cloudSpriteWidth(1920)).toBe(cloudSpriteWidth(2560));
    });

    it('пропорция «облако к танку» одна на всех ширинах', () => {
        const ratios = [1280, 1920, 2560].map(
            (w) => cloudSpriteWidth(w) / (WORLD_UNITS.tankWidth * computeWorldScale(w)),
        );
        for (const r of ratios) {
            expect(r).toBeCloseTo(ratios[0]);
        }
    });

    it('битая ширина не роняет размер в ноль', () => {
        expect(cloudSpriteWidth(Number.NaN)).toBeGreaterThan(0);
        expect(cloudSpriteWidth(-5)).toBeGreaterThan(0);
    });
});

describe('самое крупное облако — не больше ~2 корпусов танка (#572)', () => {
    it('на любой ширине потолок размера облака ≤ 2 корпусов танка', () => {
        for (const width of [1280, 1920, 2560]) {
            const maxCloud = cloudSpriteWidth(width) * CLOUD_SCALE_MAX;
            const tank = WORLD_UNITS.tankWidth * computeWorldScale(width);
            expect(maxCloud / tank).toBeLessThanOrEqual(2);
        }
    });

    it('фактические облака поля не превышают ~2 корпусов ни на одной ширине', () => {
        for (const width of [1280, 1920, 2560]) {
            const tank = WORLD_UNITS.tankWidth * computeWorldScale(width);
            for (let seed = 0; seed < 20; seed++) {
                for (const c of buildCloudField(`max-${seed}`, width)) {
                    const cloud = cloudSpriteWidth(width) * c.scale;
                    expect(cloud / tank).toBeLessThanOrEqual(2);
                }
            }
        }
    });
});

describe('cloudPlane — план облака выведен из высоты (#572)', () => {
    it('у верха кадра план = 1 (ближний), у линии гор → 0 (дальний)', () => {
        expect(cloudPlane(Y_MIN)).toBeCloseTo(1);
        expect(cloudPlane(MOUNTAIN_HORIZON_FRAC)).toBeCloseTo(0);
    });

    it('монотонно убывает с высотой: ниже облако — меньше план', () => {
        expect(cloudPlane(0.1)).toBeGreaterThan(cloudPlane(0.3));
        expect(cloudPlane(0.3)).toBeGreaterThan(cloudPlane(0.48));
    });

    it('зажат в [0, 1] за пределами штатного диапазона высот', () => {
        expect(cloudPlane(-1)).toBe(1);
        expect(cloudPlane(1)).toBe(0);
    });
});

describe('windFactor — облака плывут по ветру боя (#518)', () => {
    it('знак ветра задаёт сторону: влево — значит влево', () => {
        expect(windFactor(-MAX_WIND)).toBeLessThan(0);
        expect(windFactor(MAX_WIND)).toBeGreaterThan(0);
    });

    it('сильнее ветер — быстрее облака', () => {
        expect(Math.abs(windFactor(MAX_WIND))).toBeGreaterThan(Math.abs(windFactor(MAX_WIND / 2)));
    });

    it('при штиле облака не встают колом, а еле ползут', () => {
        // Ноль читался бы как поломка («небо замерло»), а не как безветрие.
        expect(windFactor(0)).toBeGreaterThan(0);
        expect(windFactor(0)).toBeLessThan(Math.abs(windFactor(MAX_WIND)) / 2);
    });

    it('ветер сверх шкалы не разгоняет небо до гоночной трассы', () => {
        expect(Math.abs(windFactor(MAX_WIND * 100))).toBe(Math.abs(windFactor(MAX_WIND)));
    });

    it('битое значение ветра не роняет движение', () => {
        expect(windFactor(Number.NaN)).toBeGreaterThan(0);
    });
});

describe('buildCloudField — детерминизм и разреженность', () => {
    it('один сид даёт то же небо', () => {
        expect(buildCloudField('daily-2026-08-13', 1280)).toEqual(
            buildCloudField('daily-2026-08-13', 1280),
        );
    });

    it('разные сиды дают разные небеса', () => {
        expect(buildCloudField('a', 1280)).not.toEqual(buildCloudField('b', 1280));
    });

    it('облака разнесены по секторам, а не слипаются в кучу', () => {
        // Свободный random регулярно ставил два облака вплотную, оставляя полнеба пустым.
        const field = buildCloudField('seed-1', 1280);
        const xs = field.map((c) => c.xFrac).sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) {
            expect(xs[i] - xs[i - 1]).toBeGreaterThan(0.05);
        }
    });

    it('облака живут в верхней части неба, над рельефом', () => {
        for (const c of buildCloudField('seed-y', 1280)) {
            expect(c.yFrac).toBeGreaterThanOrEqual(Y_MIN);
            expect(c.yFrac).toBeLessThanOrEqual(Y_MAX);
        }
    });
});

describe('план монотонно связан с высотой: ниже — мельче, медленнее, бледнее, площе (#572)', () => {
    it('скорость каждого облака = план его высоты (не отдельный бросок)', () => {
        for (const c of buildCloudField('speed', 1600)) {
            const t = cloudPlane(c.yFrac);
            expect(c.speed).toBeCloseTo(CLOUD_SPEED_MIN + (CLOUD_SPEED_MAX - CLOUD_SPEED_MIN) * t);
        }
    });

    it('прозрачность и сжатие каждого облака = план его высоты', () => {
        for (const c of buildCloudField('haze', 1600)) {
            const t = cloudPlane(c.yFrac);
            expect(c.alpha).toBeCloseTo(CLOUD_HAZE_MIN + (1 - CLOUD_HAZE_MIN) * t);
            expect(c.squashY).toBeCloseTo(CLOUD_SQUASH_MIN + (1 - CLOUD_SQUASH_MIN) * t);
        }
    });

    it('у горизонта облако бледнее и площе, у верха кадра — полное', () => {
        for (const c of buildCloudField('range', 1600)) {
            expect(c.alpha).toBeGreaterThanOrEqual(CLOUD_HAZE_MIN);
            expect(c.alpha).toBeLessThanOrEqual(1);
            expect(c.squashY).toBeGreaterThanOrEqual(CLOUD_SQUASH_MIN);
            expect(c.squashY).toBeLessThanOrEqual(1);
        }
    });

    it('чем выше облако (меньше yFrac), тем крупнее в среднем — размер связан с планом', () => {
        // Разброс внутри плана — по многим сидам, а не по одному полю.
        const upper: number[] = [];
        const lower: number[] = [];
        for (let seed = 0; seed < 60; seed++) {
            for (const c of buildCloudField(`plane-scale-${seed}`, 1600)) {
                (c.yFrac < (Y_MIN + Y_MAX) / 2 ? upper : lower).push(c.scale);
            }
        }
        const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
        expect(avg(upper)).toBeGreaterThan(avg(lower));
    });

    it('скорость и высота идут вместе: сортируем по высоте — скорость монотонна', () => {
        const field = buildCloudField('mono', 1600)
            .slice()
            .sort((a, b) => a.yFrac - b.yFrac);
        for (let i = 1; i < field.length; i++) {
            // yFrac растёт (вниз) → скорость не растёт (медленнее у горизонта).
            expect(field[i].speed).toBeLessThanOrEqual(field[i - 1].speed + 1e-9);
        }
    });
});

describe('разброс масштаба ВНУТРИ плана сохранён — поле не распадается на пресеты (#572)', () => {
    it('масштаб не строго функция высоты: есть джиттер вокруг плана', () => {
        let sawJitter = false;
        for (let seed = 0; seed < 40 && !sawJitter; seed++) {
            for (const c of buildCloudField(`jitter-${seed}`, 1600)) {
                const base =
                    CLOUD_SCALE_MIN + (CLOUD_SCALE_MAX - CLOUD_SCALE_MIN) * cloudPlane(c.yFrac);
                if (Math.abs(c.scale - base) > 1e-6) sawJitter = true;
            }
        }
        expect(sawJitter).toBe(true);
    });

    it('масштаб держится в границах по всему полю', () => {
        for (const c of buildCloudField('bounds', 1280)) {
            expect(c.scale).toBeGreaterThanOrEqual(CLOUD_SCALE_MIN);
            expect(c.scale).toBeLessThanOrEqual(CLOUD_SCALE_MAX);
        }
    });

    it('облака заметно разного размера в пределах одного поля', () => {
        const scales = buildCloudField('seed-scale', 1280).map((c) => c.scale);
        expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.3);
    });
});

describe('распределение высот смещено к линии гор (#572)', () => {
    it('у горизонта облаков больше — перспектива сжимает расстояния', () => {
        let lower = 0;
        let upper = 0;
        const mid = (Y_MIN + Y_MAX) / 2;
        for (let seed = 0; seed < 60; seed++) {
            for (const c of buildCloudField(`bias-${seed}`, 1600)) {
                if (c.yFrac >= mid) lower++;
                else upper++;
            }
        }
        expect(lower).toBeGreaterThan(upper);
    });
});

describe('часть облаков зеркалится по X — те же три спрайта дают разные силуэты (#515)', () => {
    it('в большой выборке встречаются и зеркальные, и обычные', () => {
        const mirrored: boolean[] = [];
        for (let seed = 0; seed < 20; seed++) {
            for (const c of buildCloudField(`mirror-${seed}`, 1600)) {
                mirrored.push(c.mirror);
            }
        }
        expect(mirrored.some((v) => v)).toBe(true);
        expect(mirrored.some((v) => !v)).toBe(true);
    });
});
