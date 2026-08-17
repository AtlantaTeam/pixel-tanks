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

    it('зеркалит --color-surface из globals.css (ночная тонировка земли, #545)', () => {
        const cssSurface = readCssToken('--color-surface');
        expect(cssSurface).toBeDefined();
        expect(ENGINE_COLORS.surface).toBe(cssSurface);
    });

    it('зеркалит --color-border-strong из globals.css (линия земли демо витрины, issue #496)', () => {
        const cssBorderStrong = readCssToken('--color-border-strong');
        expect(cssBorderStrong).toBeDefined();
        expect(ENGINE_COLORS.borderStrong).toBe(cssBorderStrong);
    });

    it('зеркалит --color-enemy из globals.css (призрачная трасса бота, issue #543)', () => {
        const cssEnemy = readCssToken('--color-enemy');
        expect(cssEnemy).toBeDefined();
        expect(ENGINE_COLORS.enemy).toBe(cssEnemy);
    });

    it('зеркалит --color-warning из globals.css (полотнище флажка ветра, #579)', () => {
        const cssWarning = readCssToken('--color-warning');
        expect(cssWarning).toBeDefined();
        expect(ENGINE_COLORS.warning).toBe(cssWarning);
    });

    it('зеркалит --color-warning-ink из globals.css (обводка флажка ветра, #579)', () => {
        const cssWarningInk = readCssToken('--color-warning-ink');
        expect(cssWarningInk).toBeDefined();
        expect(ENGINE_COLORS.warningInk).toBe(cssWarningInk);
    });

    it('зеркалит --color-text-muted из globals.css (ядро мачты флажка, #579)', () => {
        const cssTextMuted = readCssToken('--color-text-muted');
        expect(cssTextMuted).toBeDefined();
        expect(ENGINE_COLORS.textMuted).toBe(cssTextMuted);
    });

    it('полотнище флажка ветра не совпадает с accent интерфейса (#579)', () => {
        expect(ENGINE_COLORS.warning).not.toBe(ENGINE_COLORS.accent);
    });
});
