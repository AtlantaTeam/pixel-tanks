import { describe, expect, it } from 'vitest';
import {
    buildCloudField,
    cloudCount,
    CLOUD_COUNT_MAX,
    CLOUD_COUNT_MIN,
    CLOUD_SCALE_MAX,
    CLOUD_SCALE_MIN,
    CLOUD_SPEEDS,
    cloudSpriteWidth,
    windFactor,
} from './cloud-field';
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

describe('cloudSpriteWidth — размер от ширины экрана (#523)', () => {
    it('на 1280 облако 192 CSS-px — размер из одобренного кадра', () => {
        expect(cloudSpriteWidth(1280)).toBe(192);
    });

    it('на телефоне облако не занимает полэкрана', () => {
        // Фикс в 192 px давал на 390 ровно половину ширины — облака наезжали друг на друга.
        expect(cloudSpriteWidth(390) / 390).toBeLessThan(0.2);
    });

    it('доля ширины держится одинаковой на всех разрешениях', () => {
        for (const width of [414, 768, 1024, 1280]) {
            const frac = cloudSpriteWidth(width) / width;
            expect(frac).toBeGreaterThan(0.1);
            expect(frac).toBeLessThan(0.2);
        }
    });

    it('на очень узком не вырождается в точку, на очень широком не раздувается', () => {
        expect(cloudSpriteWidth(200)).toBeGreaterThanOrEqual(48);
        expect(cloudSpriteWidth(4000)).toBe(192);
    });

    it('битая ширина не роняет размер в ноль', () => {
        expect(cloudSpriteWidth(Number.NaN)).toBeGreaterThan(0);
        expect(cloudSpriteWidth(-5)).toBeGreaterThan(0);
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

    it('соседние облака плывут с разными скоростями — это и есть параллакс', () => {
        const field = buildCloudField('seed-parallax', 1600);
        expect(new Set(field.map((c) => c.speed)).size).toBeGreaterThan(1);
        field.forEach((c) => expect(CLOUD_SPEEDS).toContain(c.speed));
    });

    it('облака живут в верхней части неба, над рельефом, но разброс по высоте шире прежнего (#515)', () => {
        for (const c of buildCloudField('seed-y', 1280)) {
            expect(c.yFrac).toBeGreaterThanOrEqual(0.04);
            expect(c.yFrac).toBeLessThanOrEqual(0.48);
        }
    });

    it('разброс по вертикали действительно шире прежних 0.04–0.34 (#515)', () => {
        // Прежняя верхняя граница была 0.34 — в эталоне облака стоят и ниже.
        // Собираем большую выборку: на одном узком поле низких облаков может не выпасть.
        let sawLower = false;
        for (let seed = 0; seed < 40 && !sawLower; seed++) {
            for (const c of buildCloudField(`low-cloud-${seed}`, 1600)) {
                if (c.yFrac > 0.34) sawLower = true;
            }
        }
        expect(sawLower).toBe(true);
    });

    it('облака заметно разного размера в пределах одного поля (#515)', () => {
        // Ведущая гипотеза приёмки: единый масштаб на все облака и есть причина
        // «неинтересного» неба — нужен разброс, видимый на одном экране.
        const field = buildCloudField('seed-scale', 1280);
        const scales = field.map((c) => c.scale);
        expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.3);
        for (const scale of scales) {
            expect(scale).toBeGreaterThanOrEqual(CLOUD_SCALE_MIN);
            expect(scale).toBeLessThanOrEqual(CLOUD_SCALE_MAX);
        }
    });

    it('мелкое облако — оно же дальнее — оно же медленное: масштаб связан со скоростью (#515)', () => {
        // Собираем большую выборку по многим сидам, а не полагаемся на один field —
        // диапазоны ярусов пересекаются нарочно (внутри яруса тоже есть разброс).
        const bySpeed = new Map<number, number[]>();
        for (let seed = 0; seed < 40; seed++) {
            for (const c of buildCloudField(`speed-scale-${seed}`, 1600)) {
                const list = bySpeed.get(c.speed) ?? [];
                list.push(c.scale);
                bySpeed.set(c.speed, list);
            }
        }
        const speeds = [...CLOUD_SPEEDS];
        const avgScale = (speed: number) => {
            const list = bySpeed.get(speed) ?? [];
            return list.reduce((sum, v) => sum + v, 0) / list.length;
        };
        const avgBySpeed = speeds.map(avgScale);
        for (let i = 1; i < avgBySpeed.length; i++) {
            expect(avgBySpeed[i]).toBeGreaterThan(avgBySpeed[i - 1]);
        }
    });

    it('часть облаков зеркалится по X — те же три спрайта дают разные силуэты (#515)', () => {
        // На одном поле выборка маленькая (3–10 облаков) — набираем большую выборку по сидам.
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
