import { AIM_PREVIEW_DEFAULTS, calculateAimPreviewDots } from './aim-preview';

describe('calculateAimPreviewDots', () => {
    const gunpoint = { x: 100, y: 200 };

    it('строит точки вдоль угла 0 (по горизонтали вправо)', () => {
        const dots = calculateAimPreviewDots(gunpoint, 0, 10);

        expect(dots.length).toBeGreaterThan(0);
        for (const dot of dots) {
            expect(dot.y).toBeCloseTo(gunpoint.y);
            expect(dot.x).toBeGreaterThan(gunpoint.x);
        }
    });

    it('строит точки вдоль угла -π/2 (вертикально вверх, ось Y канваса вниз)', () => {
        const dots = calculateAimPreviewDots(gunpoint, -Math.PI / 2, 10);

        for (const dot of dots) {
            expect(dot.x).toBeCloseTo(gunpoint.x);
            expect(dot.y).toBeLessThan(gunpoint.y);
        }
    });

    it('количество точек растёт с мощностью выстрела', () => {
        const fewDots = calculateAimPreviewDots(gunpoint, 0, 1);
        const manyDots = calculateAimPreviewDots(gunpoint, 0, 20);

        expect(manyDots.length).toBeGreaterThan(fewDots.length);
    });

    it('последняя точка лежит на расстоянии minLength + power * lengthPerPower от дула', () => {
        const power = 5;
        const dots = calculateAimPreviewDots(gunpoint, 0, power);
        const expectedLength =
            AIM_PREVIEW_DEFAULTS.minLength + power * AIM_PREVIEW_DEFAULTS.lengthPerPower;
        const last = dots[dots.length - 1];

        expect(last.x - gunpoint.x).toBeLessThanOrEqual(expectedLength);
        expect(last.x - gunpoint.x).toBeGreaterThan(
            expectedLength - AIM_PREVIEW_DEFAULTS.dotSpacing,
        );
    });

    it('детерминирована: одинаковый вход даёт одинаковый результат', () => {
        expect(calculateAimPreviewDots(gunpoint, 1.23, 7)).toEqual(
            calculateAimPreviewDots(gunpoint, 1.23, 7),
        );
    });

    it('уважает переданные опции вместо дефолтов', () => {
        const dots = calculateAimPreviewDots(gunpoint, 0, 1, {
            minLength: 0,
            lengthPerPower: 0,
            dotSpacing: 5,
        });

        expect(dots).toEqual([]);
    });
});
