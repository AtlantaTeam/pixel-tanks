import { describe, expect, it } from 'vitest';
import { pluralizeRu } from './plural-ru';

const forms: [string, string, string] = ['очко', 'очка', 'очков'];

describe('pluralizeRu', () => {
    it('uses the singular form for 1 and numbers ending in 1 (except 11)', () => {
        expect(pluralizeRu(1, forms)).toBe('очко');
        expect(pluralizeRu(21, forms)).toBe('очко');
        expect(pluralizeRu(101, forms)).toBe('очко');
    });

    it('uses the few form for numbers ending in 2-4 (except 12-14)', () => {
        expect(pluralizeRu(2, forms)).toBe('очка');
        expect(pluralizeRu(3, forms)).toBe('очка');
        expect(pluralizeRu(42, forms)).toBe('очка');
        expect(pluralizeRu(24, forms)).toBe('очка');
    });

    it('uses the many form for 0, 5-20 and the 11-14 exception', () => {
        expect(pluralizeRu(0, forms)).toBe('очков');
        expect(pluralizeRu(5, forms)).toBe('очков');
        expect(pluralizeRu(11, forms)).toBe('очков');
        expect(pluralizeRu(12, forms)).toBe('очков');
        expect(pluralizeRu(14, forms)).toBe('очков');
        expect(pluralizeRu(100, forms)).toBe('очков');
    });
});
