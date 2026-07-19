import { describe, expect, it } from 'vitest';
import { resolveKeyboardIntent } from './keyboard-scheme';

describe('resolveKeyboardIntent', () => {
    it('maps ArrowLeft/ArrowRight without Ctrl to angle adjustment', () => {
        expect(resolveKeyboardIntent('ArrowLeft', false)).toBe('angle-left');
        expect(resolveKeyboardIntent('ArrowRight', false)).toBe('angle-right');
    });

    it('maps ArrowUp/ArrowDown without Ctrl to power adjustment', () => {
        expect(resolveKeyboardIntent('ArrowUp', false)).toBe('power-up');
        expect(resolveKeyboardIntent('ArrowDown', false)).toBe('power-down');
    });

    it('maps Ctrl+ArrowLeft/ArrowRight to tank movement', () => {
        expect(resolveKeyboardIntent('ArrowLeft', true)).toBe('move-left');
        expect(resolveKeyboardIntent('ArrowRight', true)).toBe('move-right');
    });

    it('maps Ctrl+ArrowUp/ArrowDown to weapon cycling', () => {
        expect(resolveKeyboardIntent('ArrowUp', true)).toBe('weapon-prev');
        expect(resolveKeyboardIntent('ArrowDown', true)).toBe('weapon-next');
    });

    it('maps Space and Enter to fire without Ctrl', () => {
        expect(resolveKeyboardIntent(' ', false)).toBe('fire');
        expect(resolveKeyboardIntent('Enter', false)).toBe('fire');
    });

    it('disables fire on Ctrl+Space and Ctrl+Enter', () => {
        expect(resolveKeyboardIntent(' ', true)).toBeNull();
        expect(resolveKeyboardIntent('Enter', true)).toBeNull();
    });

    it('returns null for keys outside the combat scheme', () => {
        expect(resolveKeyboardIntent('Tab', false)).toBeNull();
        expect(resolveKeyboardIntent('a', false)).toBeNull();
        expect(resolveKeyboardIntent('Escape', true)).toBeNull();
    });
});
