import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Читает globals.css — источник правды токенов и переключения темы. */
function readGlobalsCss(): string {
    // vitest запускается из корня проекта, поэтому путь строим от cwd
    // (happy-dom не даёт file://-URL через import.meta.url).
    return readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
}

describe('дизайн-система: ядро токенов + переключение темы (docs/design-system-theming/token-spec.md)', () => {
    it('содержит семантические токены фракций из token-spec', () => {
        const css = readGlobalsCss();

        expect(css).toMatch(/--color-primary:\s*#ffc21f/);
        expect(css).toMatch(/--color-primary-ink:\s*#241900/);
        expect(css).toMatch(/--color-accent:\s*#48ff00/);
        expect(css).toMatch(/--color-accent-ink:\s*#052400/);
        expect(css).toMatch(/--color-enemy:\s*#c900ff/);
        expect(css).toMatch(/--color-enemy-ink:\s*#1e0030/);
    });

    it('дефолтная тема (:root) указывает --accent на фракцию игрока', () => {
        const css = readGlobalsCss();
        const rootBlock = css.match(/:root\s*{([^}]*)}/)?.[1];

        expect(rootBlock).toBeDefined();
        expect(rootBlock).toMatch(/--accent:\s*var\(--color-accent\)/);
        expect(rootBlock).toMatch(/--accent-ink:\s*var\(--color-accent-ink\)/);
    });

    it('[data-faction="enemy"] переопределяет --accent на фракцию врага', () => {
        const css = readGlobalsCss();
        const enemyBlock = css.match(/\[data-faction=['"]enemy['"]\]\s*{([^}]*)}/)?.[1];

        expect(enemyBlock).toBeDefined();
        expect(enemyBlock).toMatch(/--accent:\s*var\(--color-enemy\)/);
        expect(enemyBlock).toMatch(/--accent-ink:\s*var\(--color-enemy-ink\)/);
        expect(enemyBlock).toMatch(/--glow:\s*var\(--glow-enemy\)/);
    });
});
