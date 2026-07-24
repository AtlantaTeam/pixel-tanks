import { describe, expect, it } from 'vitest';
import { themeAttrs } from './theme-attrs';

describe('themeAttrs', () => {
    it('returns an empty object when no theme axis is set', () => {
        expect(themeAttrs()).toEqual({});
        expect(themeAttrs({})).toEqual({});
    });

    it('writes data-faction for the enemy faction', () => {
        expect(themeAttrs({ faction: 'enemy' })).toEqual({ 'data-faction': 'enemy' });
    });

    it('writes data-outcome for a defeat', () => {
        expect(themeAttrs({ outcome: 'defeat' })).toEqual({ 'data-outcome': 'defeat' });
    });

    it('writes data-intensity only for calm, not for the normal default', () => {
        expect(themeAttrs({ intensity: 'calm' })).toEqual({ 'data-intensity': 'calm' });
        expect(themeAttrs({ intensity: 'normal' })).toEqual({});
    });

    it('combines several axes at once', () => {
        expect(themeAttrs({ faction: 'enemy', outcome: 'victory', intensity: 'calm' })).toEqual({
            'data-faction': 'enemy',
            'data-outcome': 'victory',
            'data-intensity': 'calm',
        });
    });
});
