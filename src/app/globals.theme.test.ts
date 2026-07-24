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

    it('содержит полную палитру статусов из token-spec (включая danger-ink)', () => {
        const css = readGlobalsCss();

        expect(css).toMatch(/--color-danger:\s*#ff4242/);
        expect(css).toMatch(/--color-danger-ink:\s*#2b0000/);
        expect(css).toMatch(/--color-warning:\s*#ffa900/);
        expect(css).toMatch(/--color-warning-ink:\s*#2a1600/);
        expect(css).toMatch(/--color-success:\s*#48ff00/);
    });

    it('содержит радиусы дизайн-системы', () => {
        const css = readGlobalsCss();

        expect(css).toMatch(/--radius-none:\s*0px/);
        expect(css).toMatch(/--radius-sm:\s*2px/);
    });

    it('содержит тени панелей/диалогов', () => {
        const css = readGlobalsCss();

        expect(css).toMatch(/--shadow-panel:\s*0 4px 0/);
        expect(css).toMatch(/--shadow-drop:\s*0 6px 0/);
    });

    it('содержит шрифтовые токены дизайн-системы (Pixelify Sans + JetBrains Mono)', () => {
        const css = readGlobalsCss();

        expect(css).toMatch(/--font-display:\s*'Pixelify Sans'/);
        expect(css).toMatch(/--font-ui:\s*'JetBrains Mono'/);
    });

    it('подключает Pixelify Sans и JetBrains Mono self-hosted (latin + cyrillic)', () => {
        const css = readGlobalsCss();

        expect(css).toMatch(
            /font-family:\s*'Pixelify Sans'[\s\S]*?url\('\/fonts\/pixelify-sans-latin\.woff2'\)/,
        );
        expect(css).toMatch(
            /font-family:\s*'Pixelify Sans'[\s\S]*?url\('\/fonts\/pixelify-sans-cyrillic\.woff2'\)/,
        );
        expect(css).toMatch(
            /font-family:\s*'JetBrains Mono'[\s\S]*?url\('\/fonts\/jetbrains-mono-latin\.woff2'\)/,
        );
        expect(css).toMatch(
            /font-family:\s*'JetBrains Mono'[\s\S]*?url\('\/fonts\/jetbrains-mono-cyrillic\.woff2'\)/,
        );
    });

    it('содержит полный набор ролей типографической шкалы из token-spec', () => {
        const css = readGlobalsCss();
        const roles = [
            'display',
            'h1',
            'h2',
            'hud-xl',
            'hud',
            'button',
            'body',
            'caption',
            'label',
        ];

        for (const role of roles) {
            expect(css).toMatch(new RegExp(`--text-${role}:\\s*`));
            expect(css).toMatch(new RegExp(`--text-${role}--line-height:\\s*`));
        }
    });
});
