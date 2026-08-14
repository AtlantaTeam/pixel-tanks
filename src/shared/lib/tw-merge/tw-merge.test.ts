import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { twMerge } from './tw-merge';
import { THEME_FONT_SIZES } from './tw-merge';

/** Имена кастомных размеров шрифта, объявленных в `@theme` globals.css. */
function readThemeFontSizes(): string[] {
    // vitest стартует из корня проекта (как в engine-palette.test.ts).
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    const names = new Set<string>();
    for (const match of css.matchAll(/--text-([a-z0-9-]+):/g)) {
        // `--text-hud--line-height` — модификатор того же токена, не отдельный размер.
        if (!match[1].includes('--')) names.add(match[1]);
    }
    return [...names];
}

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
