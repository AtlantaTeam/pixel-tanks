import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/shared/lib/random';
import {
    buildStarField,
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
