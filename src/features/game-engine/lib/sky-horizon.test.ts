import { describe, expect, it } from 'vitest';
import { cloudPlane } from './cloud-field';
import { maxCelestialYFrac } from './sky-celestial';
import {
    MOUNTAIN_BAND_HEIGHT_FRAC,
    MOUNTAIN_BAND_TOP_FRAC,
    MOUNTAIN_HORIZON_FRAC,
} from './sky-horizon';

/**
 * Полоса гор — общее число трёх модулей неба, и на неё ссылаются докблоки облаков,
 * светила и самой сцены. Тест пиннит ЗАДОКУМЕНТИРОВАННЫЙ контракт: сузят полосу, не
 * поправив тех, кто на неё опирается, — покраснеет здесь.
 */
describe('sky-horizon — полоса дальних гор', () => {
    it('занимает [0.46 … 0.62] высоты, как обещают докблоки неба', () => {
        expect(MOUNTAIN_HORIZON_FRAC).toBeCloseTo(0.62, 6);
        expect(MOUNTAIN_BAND_TOP_FRAC).toBeCloseTo(0.46, 6);
        expect(MOUNTAIN_HORIZON_FRAC - MOUNTAIN_BAND_TOP_FRAC).toBeCloseTo(
            MOUNTAIN_BAND_HEIGHT_FRAC,
            6,
        );
    });

    it('подошва полосы — тот же горизонт, от которого считают облака и светило', () => {
        // Облако: план на линии горизонта вырождается в 0 (дальше некуда).
        expect(cloudPlane(MOUNTAIN_HORIZON_FRAC)).toBeCloseTo(0, 6);
        // Светило: потолок высоты обязан оставлять диск НАД подошвой силуэта.
        const radiusFrac = 0.095;
        expect(maxCelestialYFrac('sunset', radiusFrac) + radiusFrac).toBeLessThan(
            MOUNTAIN_HORIZON_FRAC,
        );
    });
});
