import { bp, frameset, SCREEN_FRAME_HEIGHT } from './frameset';

describe('bp', () => {
    it('считает отображаемый размер кадра как ширина/высота × scale', () => {
        const frame = bp(768, 720, 0.62, 'Планшет · 768', 'tablet');

        expect(frame.dispW).toBe(476);
        expect(frame.dispH).toBe(446);
    });

    it('округляет дробный результат масштабирования до целых пикселей', () => {
        const frame = bp(1920, 720, 0.3, 'Wide · 1920', 'desktop');

        expect(frame.dispW).toBe(576);
        expect(frame.dispH).toBe(216);
    });

    it('оставляет размер кадра без изменений при scale = 1', () => {
        const frame = bp(390, 720, 1, 'Mobile · 390', 'mobile');

        expect(frame.dispW).toBe(390);
        expect(frame.dispH).toBe(720);
    });

    it('сохраняет исходные ширину, высоту, scale, подпись и вариант layout', () => {
        const frame = bp(1280, 720, 0.42, 'Desktop · 1280', 'desktop');

        expect(frame).toMatchObject({
            w: 1280,
            h: 720,
            scale: 0.42,
            label: 'Desktop · 1280',
            variant: 'desktop',
        });
    });
});

describe('frameset', () => {
    it('отдаёт четыре кадра инвентаря: 390 / 768 / 1280 / 1920', () => {
        expect(frameset().map((frame) => frame.w)).toEqual([390, 768, 1280, 1920]);
    });

    it('держит высоту кадра одинаковой на всех брейкпоинтах', () => {
        expect(frameset().every((frame) => frame.h === SCREEN_FRAME_HEIGHT)).toBe(true);
    });

    it('переиспользует desktop-вариант layout на кадрах 1280 и 1920', () => {
        expect(frameset().map((frame) => frame.variant)).toEqual([
            'mobile',
            'tablet',
            'desktop',
            'desktop',
        ]);
    });

    it('подписывает каждый кадр именем брейкпоинта', () => {
        expect(frameset().map((frame) => frame.label)).toEqual([
            'Mobile · 390',
            'Планшет · 768',
            'Desktop · 1280',
            'Wide · 1920',
        ]);
    });
});
