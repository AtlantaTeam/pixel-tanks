import { afterEach, describe, expect, it } from 'vitest';
import { mockReducedMotion } from './mock-reduced-motion';
import { prefersReducedMotion } from './prefers-reduced-motion';

describe('prefersReducedMotion', () => {
    let restore: (() => void) | undefined;

    afterEach(() => {
        restore?.();
        restore = undefined;
    });

    it('возвращает true, когда медиа-запрос reduce совпадает', () => {
        restore = mockReducedMotion(true);
        expect(prefersReducedMotion()).toBe(true);
    });

    it('возвращает false, когда движение разрешено', () => {
        restore = mockReducedMotion(false);
        expect(prefersReducedMotion()).toBe(false);
    });
});
