import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_FONT_SIZES, twMerge } from './tw-merge';

/** Тела всех блоков `@theme { … }` файла — токены темы объявляются только там. */
function themeBlocks(css: string): string[] {
    const blocks: string[] = [];
    for (const match of css.matchAll(/@theme\s*\{/g)) {
        let depth = 1;
        let i = (match.index ?? 0) + match[0].length;
        const start = i;
        while (i < css.length && depth > 0) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
            i++;
        }
        blocks.push(css.slice(start, i - 1));
    }
    return blocks;
}

/**
 * Имена кастомных РАЗМЕРОВ ШРИФТА, объявленных в `@theme` globals.css.
 *
 * Разбор сужен до тела `@theme` и до собственно размеров (ревью #554): голый
 * `--text-*` по всему файлу забирал бы и соседние подпространства того же
 * неймспейса — в Tailwind 4 там же живут `--text-shadow-*` (утилиты
 * `text-shadow-*`). Заведи кто-нибудь токен тени текста — оракул потребовал бы
 * внести его в `THEME_FONT_SIZES`, то есть объявить тень размером шрифта и
 * сломать ровно то различение, которое `tw-merge.ts` наводит.
 */
function parseThemeFontSizes(css: string): string[] {
    const names = new Set<string>();
    for (const block of themeBlocks(css)) {
        for (const match of block.matchAll(/--text-([a-z0-9-]+):/g)) {
            const name = match[1];
            // `--text-hud--line-height` — модификатор того же токена, не отдельный размер.
            if (name.includes('--')) continue;
            // `--text-shadow-*` — тени текста, чужое подпространство неймспейса.
            if (name === 'shadow' || name.startsWith('shadow-')) continue;
            names.add(name);
        }
    }
    return [...names];
}

function readThemeFontSizes(): string[] {
    // vitest стартует из корня проекта (как в engine-palette.test.ts).
    return parseThemeFontSizes(readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8'));
}

describe('оракул размеров шрифта из @theme', () => {
    it('берёт только размеры: тени текста и токены вне @theme — мимо', () => {
        const css = `
            @theme {
                --text-hud: 20px;
                --text-hud--line-height: 1.1;
                --text-shadow-glow: 0 0 2px #000;
            }
            .demo {
                --text-fake: 12px;
            }
        `;

        expect(parseThemeFontSizes(css)).toEqual(['hud']);
    });
});

describe('twMerge с токенами темы', () => {
    it('знает все кастомные размеры шрифта из @theme globals.css', () => {
        // Появится новый `--text-*` — список в `tw-merge.ts` обязан пополниться,
        // иначе новый размер молча начнёт считаться цветом текста.
        expect([...THEME_FONT_SIZES].sort()).toEqual(readThemeFontSizes().sort());
    });

    it('кастомный размер не выбрасывает цвет текста (баг из ревью #554)', () => {
        // До настройки: 'text-xs text-hud' — размер оставался, цвет исчезал.
        const merged = twMerge('text-text text-xs', 'text-hud');

        expect(merged).toMatch(/\btext-text\b/);
        expect(merged).toMatch(/\btext-hud\b/);
        expect(merged).not.toMatch(/\btext-xs\b/);
    });

    it('кастомный размер вытесняет стоковый и наоборот', () => {
        expect(twMerge('text-caption', 'text-base')).toBe('text-base');
        expect(twMerge('text-base', 'text-caption')).toBe('text-caption');
    });

    it('два кастомных размера конфликтуют между собой — побеждает последний', () => {
        expect(twMerge('text-hud', 'text-hud-xl')).toBe('text-hud-xl');
    });

    it('кастомный цвет текста по-прежнему вытесняется цветом, а не размером', () => {
        expect(twMerge('text-text-muted', 'text-danger')).toBe('text-danger');
        expect(twMerge('text-text-muted text-label', 'text-danger')).toBe('text-label text-danger');
    });

    it('не трогает неконфликтующие утилиты', () => {
        expect(twMerge('flex gap-2', 'items-center')).toBe('flex gap-2 items-center');
    });
});
