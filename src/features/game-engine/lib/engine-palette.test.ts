import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_COLORS } from './engine-palette';

/** Читает hex токена `--name` из globals.css — источника правды палитры. */
function readCssToken(name: string): string | undefined {
    // vitest запускается из корня проекта, поэтому путь строим от cwd
    // (happy-dom не даёт file://-URL через import.meta.url).
    const cssPath = resolve(process.cwd(), 'src/app/globals.css');
    const css = readFileSync(cssPath, 'utf8');
    return css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`))?.[1];
}

describe('ENGINE_COLORS', () => {
    it('зеркалит --color-primary из globals.css', () => {
        // Сверяем не с хардкодом, а с живым значением токена: если --color-primary
        // поменяют в globals.css, тест поймает рассинхрон движка с UI.
        const cssPrimary = readCssToken('--color-primary');
        expect(cssPrimary).toBeDefined();
        expect(ENGINE_COLORS.primary).toBe(cssPrimary);
    });

    it('зеркалит --color-accent из globals.css (сегмент направления жеста)', () => {
        const cssAccent = readCssToken('--color-accent');
        expect(cssAccent).toBeDefined();
        expect(ENGINE_COLORS.accent).toBe(cssAccent);
    });

    it('зеркалит --color-danger из globals.css (индикатор и дуга на максимуме силы)', () => {
        const cssDanger = readCssToken('--color-danger');
        expect(cssDanger).toBeDefined();
        expect(ENGINE_COLORS.danger).toBe(cssDanger);
    });
});
