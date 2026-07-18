import { calculateDragAim, DRAG_AIM_DEFAULTS } from './drag-aim';

describe('calculateDragAim', () => {
    const start = { x: 200, y: 300 };

    it('возвращает null, когда оттяжка короче порога (случайный тап)', () => {
        const current = { x: 200 + DRAG_AIM_DEFAULTS.minDragDistance - 1, y: 300 };

        expect(calculateDragAim(start, current)).toBeNull();
    });

    it('оттяжка влево даёт выстрел вправо (угол 0)', () => {
        const aim = calculateDragAim(start, { x: 120, y: 300 });

        expect(aim).not.toBeNull();
        expect(aim?.angle).toBeCloseTo(0);
        expect(aim?.power).toBe(10);
    });

    it('оттяжка вниз даёт выстрел вверх (угол -π/2 в координатах canvas)', () => {
        const aim = calculateDragAim(start, { x: 200, y: 380 });

        expect(aim?.angle).toBeCloseTo(-Math.PI / 2);
    });

    it('оттяжка вправо-вниз даёт выстрел влево-вверх (угол -3π/4)', () => {
        const aim = calculateDragAim(start, { x: 280, y: 380 });

        expect(aim?.angle).toBeCloseTo((-3 * Math.PI) / 4);
    });

    it('мощность растёт с длиной оттяжки', () => {
        const short = calculateDragAim(start, { x: 160, y: 300 });
        const long = calculateDragAim(start, { x: 80, y: 300 });

        expect(short?.power).toBe(5);
        expect(long?.power).toBe(15);
    });

    it('мощность не превышает powerMax при сверхдлинной оттяжке', () => {
        const aim = calculateDragAim(start, { x: 1200, y: 300 });

        expect(aim?.power).toBe(DRAG_AIM_DEFAULTS.powerMax);
    });

    it('мощность не опускается ниже powerMin сразу за порогом', () => {
        const current = { x: 200 + DRAG_AIM_DEFAULTS.minDragDistance, y: 300 };
        const aim = calculateDragAim(start, current);

        expect(aim?.power).toBe(DRAG_AIM_DEFAULTS.powerMin);
    });

    it('детерминирован: одинаковый вход даёт одинаковый результат', () => {
        const current = { x: 133, y: 377 };

        expect(calculateDragAim(start, current)).toEqual(calculateDragAim(start, current));
    });

    it('уважает переданные опции вместо дефолтов', () => {
        const aim = calculateDragAim(
            start,
            { x: 100, y: 300 },
            { pixelsPerPowerUnit: 10, powerMax: 8 },
        );

        expect(aim?.power).toBe(8);
    });
});
