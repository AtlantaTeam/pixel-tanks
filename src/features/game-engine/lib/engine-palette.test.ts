import { describe, expect, it } from 'vitest';
import { ENGINE_COLORS } from './engine-palette';

describe('ENGINE_COLORS', () => {
    it('зеркалит --color-primary из globals.css', () => {
        expect(ENGINE_COLORS.primary).toBe('#ffcd75');
    });
});
