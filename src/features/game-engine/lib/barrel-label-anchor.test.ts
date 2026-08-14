import { describe, expect, it } from 'vitest';
import { WORLD_SCALE_MAX, WORLD_UNITS } from './world-scale';
import { BARREL_LABEL_GAP, computeBarrelLabelAnchor } from './barrel-label-anchor';

describe('computeBarrelLabelAnchor', () => {
    it('смещает якорь вдоль вектора выстрела, а не строго вверх', () => {
        // Прицел под 0 рад (строго вправо): весь сдвиг уходит в X, Y не меняется.
        const anchor = computeBarrelLabelAnchor(100, 200, 0, 1);
        expect(anchor.x).toBeGreaterThan(100);
        expect(anchor.y).toBeCloseTo(200);
    });

    it('при scale===1 держит канон прежней константы (35 + зазор)', () => {
        // Вдоль оси X расстояние от точки крепления равно длине ствола плюс зазор.
        const anchor = computeBarrelLabelAnchor(0, 0, 0, 1);
        expect(anchor.x).toBeCloseTo(WORLD_UNITS.gunpointWidth + BARREL_LABEL_GAP);
    });

    it('масштабирует смещение под scale арены — подпись за дульным срезом', () => {
        // На широкой арене (scale до 1.5) ствол ~52.5px: якорь обязан быть дальше среза.
        const muzzle = WORLD_UNITS.gunpointWidth * WORLD_SCALE_MAX;
        const anchor = computeBarrelLabelAnchor(0, 0, 0, WORLD_SCALE_MAX);
        expect(anchor.x).toBeGreaterThan(muzzle);
        expect(anchor.x).toBeCloseTo(muzzle + BARREL_LABEL_GAP);
    });

    it('смещение монотонно растёт со scale', () => {
        const near = computeBarrelLabelAnchor(0, 0, 0, 1);
        const far = computeBarrelLabelAnchor(0, 0, 0, WORLD_SCALE_MAX);
        expect(far.x).toBeGreaterThan(near.x);
    });

    it('раскладывает смещение по обеим осям под углом', () => {
        const angle = Math.PI / 4;
        const anchor = computeBarrelLabelAnchor(10, 10, angle, 1);
        const offset = WORLD_UNITS.gunpointWidth + BARREL_LABEL_GAP;
        expect(anchor.x).toBeCloseTo(10 + Math.cos(angle) * offset);
        expect(anchor.y).toBeCloseTo(10 + Math.sin(angle) * offset);
    });
});
