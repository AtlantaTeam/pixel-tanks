import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import { MOUNTAIN_HORIZON_FRAC } from './cloud-field';
import {
    buildStarField,
    CELESTIAL_HORIZON_MARGIN_FRAC,
    maxCelestialYFrac,
    pickCelestialGeometry,
    STAR_COUNT_MAX,
    STAR_COUNT_MIN,
    starCount,
    withAlpha,
} from './sky-celestial';

describe('pickCelestialGeometry — детерминизм и сектор неба', () => {
    it('один сид даёт одну геометрию', () => {
        expect(pickCelestialGeometry('daily-2026-08-13', 'day')).toEqual(
            pickCelestialGeometry('daily-2026-08-13', 'day'),
        );
    });

    it('разные сиды дают разное положение', () => {
        expect(pickCelestialGeometry('a', 'day')).not.toEqual(pickCelestialGeometry('b', 'day'));
    });

    it('не расходует основной поток RNG боя (namespaced seed)', () => {
        const before = createSeededRandom(42)();
        pickCelestialGeometry(42, 'day');
        const after = createSeededRandom(42)();
        expect(after).toBe(before);
    });

    it('не расходует поток RNG выбора пресета неба', () => {
        const before = createSeededRandom('42::sky')();
        pickCelestialGeometry(42, 'day');
        const after = createSeededRandom('42::sky')();
        expect(after).toBe(before);
    });

    it('позиция по X держится в разумном секторе (не за краем экрана)', () => {
        for (let seed = 0; seed < 30; seed++) {
            const cel = pickCelestialGeometry(seed, 'day');
            expect(cel.xFrac).toBeGreaterThanOrEqual(0.14);
            expect(cel.xFrac).toBeLessThanOrEqual(0.86);
        }
    });

    it('день/ночь держат зазор от верхнего края (под HUD-оверлей арены)', () => {
        for (let seed = 0; seed < 20; seed++) {
            expect(pickCelestialGeometry(seed, 'day').yFrac).toBeGreaterThanOrEqual(0.26);
            expect(pickCelestialGeometry(seed, 'night').yFrac).toBeGreaterThanOrEqual(0.26);
        }
    });

    it('день — высоко в небе, закат — низко у горизонта, ночь — между ними', () => {
        for (let seed = 0; seed < 20; seed++) {
            const day = pickCelestialGeometry(seed, 'day');
            const sunset = pickCelestialGeometry(seed, 'sunset');
            const night = pickCelestialGeometry(seed, 'night');
            expect(day.yFrac).toBeLessThan(sunset.yFrac);
            expect(night.yFrac).toBeLessThan(sunset.yFrac);
        }
    });

    it('нижний край диска не опускается ниже линии гор ни на одном сиде', () => {
        for (let seed = 0; seed < 400; seed++) {
            for (const presetId of ['day', 'sunset', 'night'] as const) {
                const cel = pickCelestialGeometry(seed, presetId);
                // radiusFrac — доля min(width, height), то есть в долях ВЫСОТЫ диск
                // не больше radiusFrac: сумма — консервативная оценка низа диска.
                expect(cel.yFrac + cel.radiusFrac).toBeLessThanOrEqual(MOUNTAIN_HORIZON_FRAC);
            }
        }
    });

    it('строковые сиды (ежедневный вызов, реплей) держат тот же инвариант', () => {
        for (let i = 0; i < 200; i++) {
            const cel = pickCelestialGeometry(`daily-2026-08-${i}`, 'sunset');
            expect(cel.yFrac + cel.radiusFrac).toBeLessThanOrEqual(MOUNTAIN_HORIZON_FRAC);
        }
    });

    it('потолок высоты выведен из горизонта и радиуса, а не задан константой', () => {
        // Закат: диск крупный, упирается в горизонт — потолок считается от него.
        expect(maxCelestialYFrac('sunset', 0.095)).toBeCloseTo(
            MOUNTAIN_HORIZON_FRAC - 0.095 - CELESTIAL_HORIZON_MARGIN_FRAC,
            10,
        );
        // День: собственный сектор неба ниже выведенного потолка — он и остаётся.
        expect(maxCelestialYFrac('day', 0.06)).toBeCloseTo(0.4, 10);
    });

    it('потолок никогда не проваливается ниже нижней границы сектора', () => {
        // Патологический радиус (гипотетическая правка диапазона) не переворачивает
        // сектор: yMax не уходит под yMin, иначе диапазон стал бы отрицательным.
        expect(maxCelestialYFrac('sunset', 0.5)).toBeGreaterThanOrEqual(0.4);
    });

    it('разнообразие высот закатного солнца не схлопнулось в одну линию', () => {
        const heights = Array.from({ length: 300 }, (_, seed) =>
            pickCelestialGeometry(seed, 'sunset'),
        ).map((cel) => cel.yFrac);
        const spread = Math.max(...heights) - Math.min(...heights);
        expect(spread).toBeGreaterThan(0.09);
        // Высоты заполняют сектор равномерно, а не сбиваются к потолку: клэмп после
        // выбора обоих значений подпёр бы верхнюю четверть сидов в узкую полоску.
        const low = Math.min(...heights);
        const bucketSize = spread / 4;
        const buckets = [0, 0, 0, 0];
        for (const y of heights) {
            buckets[Math.min(3, Math.floor((y - low) / bucketSize))]++;
        }
        for (const count of buckets) {
            expect(count / heights.length).toBeGreaterThan(0.15);
        }
    });

    it('радиус остаётся в разумных пределах доли экрана', () => {
        for (let seed = 0; seed < 20; seed++) {
            for (const presetId of ['day', 'sunset', 'night'] as const) {
                const cel = pickCelestialGeometry(seed, presetId);
                expect(cel.radiusFrac).toBeGreaterThan(0);
                expect(cel.radiusFrac).toBeLessThan(0.12);
            }
        }
    });
});

describe('starCount — плотность звёзд от ширины', () => {
    it('шире экран — больше звёзд', () => {
        expect(starCount(390)).toBeLessThan(starCount(1920));
    });

    it('границы держат поле осмысленным на краях', () => {
        expect(starCount(10)).toBe(STAR_COUNT_MIN);
        expect(starCount(99999)).toBe(STAR_COUNT_MAX);
    });

    it('битая ширина не роняет поле в ноль', () => {
        expect(starCount(Number.NaN)).toBe(STAR_COUNT_MIN);
        expect(starCount(-10)).toBe(STAR_COUNT_MIN);
    });
});

describe('buildStarField — детерминизм и разброс', () => {
    it('один сид даёт то же звёздное небо', () => {
        expect(buildStarField('daily-2026-08-13', 1280)).toEqual(
            buildStarField('daily-2026-08-13', 1280),
        );
    });

    it('разные сиды дают разные звёзды', () => {
        expect(buildStarField('a', 1280)).not.toEqual(buildStarField('b', 1280));
    });

    it('не расходует основной поток RNG боя и поток геометрии светила', () => {
        const beforeMain = createSeededRandom(42)();
        const beforeCelestial = createSeededRandom('42::celestial')();
        buildStarField(42, 1280);
        expect(createSeededRandom(42)()).toBe(beforeMain);
        expect(createSeededRandom('42::celestial')()).toBe(beforeCelestial);
    });

    it('звёзды не спускаются к силуэту гор (0.62 высоты)', () => {
        for (const star of buildStarField('seed-y', 1280)) {
            expect(star.yFrac).toBeGreaterThanOrEqual(0);
            expect(star.yFrac).toBeLessThanOrEqual(0.56);
        }
    });

    it('альфа у звёзд разная — не однородная плашка', () => {
        const field = buildStarField('seed-alpha', 1920);
        const alphas = new Set(field.map((s) => s.alpha));
        expect(alphas.size).toBeGreaterThan(1);
    });
});

describe('withAlpha — 8-значный hex с альфой', () => {
    it('полная непрозрачность даёт суффикс ff', () => {
        expect(withAlpha('#aabbcc', 1)).toBe('#aabbccff');
    });

    it('нулевая альфа даёт суффикс 00', () => {
        expect(withAlpha('#aabbcc', 0)).toBe('#aabbcc00');
    });

    it('клэмпит альфу вне [0, 1]', () => {
        expect(withAlpha('#aabbcc', 2)).toBe('#aabbccff');
        expect(withAlpha('#aabbcc', -1)).toBe('#aabbcc00');
    });
});
