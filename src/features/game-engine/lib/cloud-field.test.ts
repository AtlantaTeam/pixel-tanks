import { describe, expect, it } from 'vitest';
import {
    buildCloudField,
    cloudCount,
    CLOUD_COUNT_MAX,
    CLOUD_COUNT_MIN,
    CLOUD_SPEEDS,
} from './cloud-field';

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

    it('соседние облака плывут с разными скоростями — это и есть параллакс', () => {
        const field = buildCloudField('seed-parallax', 1600);
        expect(new Set(field.map((c) => c.speed)).size).toBeGreaterThan(1);
        field.forEach((c) => expect(CLOUD_SPEEDS).toContain(c.speed));
    });

    it('облака живут в верхней части неба, над рельефом', () => {
        for (const c of buildCloudField('seed-y', 1280)) {
            expect(c.yFrac).toBeGreaterThanOrEqual(0.04);
            expect(c.yFrac).toBeLessThanOrEqual(0.34);
        }
    });
});
