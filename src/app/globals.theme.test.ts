import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/** Читает globals.css — источник правды токенов и переключения темы. */
function readGlobalsCss(): string {
    // vitest запускается из корня проекта, поэтому путь строим от cwd
    // (happy-dom не даёт file://-URL через import.meta.url).
    return readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
}

function readFont(name: string): Buffer {
    return readFileSync(resolve(process.cwd(), `public/fonts/${name}`));
}

// Известные теги таблиц woff2 (6-битный индекс во флагах записи каталога) — спец WOFF2.
const WOFF2_KNOWN_TAGS = [
    'cmap',
    'head',
    'hhea',
    'hmtx',
    'maxp',
    'name',
    'OS/2',
    'post',
    'cvt ',
    'fpgm',
    'glyf',
    'loca',
    'prep',
    'CFF ',
    'VORG',
    'EBDT',
    'EBLC',
    'gasp',
    'hdmx',
    'kern',
    'LTSH',
    'PCLT',
    'VDMX',
    'vhea',
    'vmtx',
    'BASE',
    'GDEF',
    'GPOS',
    'GSUB',
    'EBSC',
    'JSTF',
    'MATH',
    'CBDT',
    'CBLC',
    'COLR',
    'CPAL',
    'SVG ',
    'sbix',
    'acnt',
    'avar',
    'bdat',
    'bloc',
    'bsln',
    'cvar',
    'fdsc',
    'feat',
    'fmtx',
    'fvar',
    'gvar',
    'hsty',
    'just',
    'lcar',
    'mort',
    'morx',
    'opbd',
    'prop',
    'trak',
    'Zapf',
    'Silf',
    'Glat',
    'Gloc',
    'Feat',
    'Sill',
] as const;

type TDecodedFont = { sfnt: Buffer; tables: Record<string, { offset: number }> };

/**
 * Минимальный декодер woff2 → распакованный sfnt-поток + смещения таблиц. Нужен, чтобы
 * тест проверял РЕАЛЬНОЕ содержимое шрифта (numGlyphs, cmap), а не только строку-URL —
 * иначе битый/дублированный сабсет проходит CI зелёным (ровно то, что случилось).
 * Разбирает заголовок, каталог таблиц (UIntBase128 длины, транформы glyf/loca) и
 * brotli-распаковку блока данных. Спека: w3.org/TR/WOFF2.
 */
function decodeWoff2(buf: Buffer): TDecodedFont {
    if (buf.slice(0, 4).toString('latin1') !== 'wOF2') throw new Error('не woff2');
    const numTables = buf.readUInt16BE(12);
    const totalCompressed = buf.readUInt32BE(20);
    let p = 48;
    const readBase128 = (): number => {
        let result = 0;
        for (let i = 0; i < 5; i++) {
            const b = buf[p++];
            result = (result << 7) | (b & 0x7f);
            if (!(b & 0x80)) return result;
        }
        throw new Error('битый UIntBase128');
    };
    const dir: Array<{ tag: string; length: number }> = [];
    for (let i = 0; i < numTables; i++) {
        const flags = buf[p++];
        const tagIndex = flags & 0x3f;
        const transformVersion = (flags >> 6) & 0x3;
        let tag: string;
        if (tagIndex === 63) {
            tag = buf.slice(p, p + 4).toString('latin1');
            p += 4;
        } else {
            tag = WOFF2_KNOWN_TAGS[tagIndex];
        }
        const origLength = readBase128();
        // glyf/loca трансформированы при version 0; прочие таблицы — при version != 0.
        const transformed =
            tag === 'glyf' || tag === 'loca' ? transformVersion === 0 : transformVersion !== 0;
        const length = transformed ? readBase128() : origLength;
        dir.push({ tag, length });
    }
    const sfnt = brotliDecompressSync(buf.slice(p, p + totalCompressed));
    const tables: Record<string, { offset: number }> = {};
    let offset = 0;
    for (const t of dir) {
        tables[t.tag] = { offset };
        offset += t.length;
    }
    return { sfnt, tables };
}

/** numGlyphs из таблицы maxp (uint16 по смещению 4). */
function numGlyphs(font: TDecodedFont): number {
    return font.sfnt.readUInt16BE(font.tables.maxp.offset + 4);
}

/** Проверяет, что codepoint покрыт в cmap (форматы 4 и 12 — то, что даёт Google-сабсет). */
function cmapHas(font: TDecodedFont, cp: number): boolean {
    const { sfnt } = font;
    const base = font.tables.cmap.offset;
    const numSub = sfnt.readUInt16BE(base + 2);
    let sub: number | null = null;
    for (let i = 0; i < numSub; i++) {
        const rec = base + 4 + i * 8;
        const platform = sfnt.readUInt16BE(rec);
        const encoding = sfnt.readUInt16BE(rec + 2);
        if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) {
            sub = base + sfnt.readUInt32BE(rec + 4);
        }
    }
    if (sub === null) return false;
    const format = sfnt.readUInt16BE(sub);
    if (format === 4) {
        const segX2 = sfnt.readUInt16BE(sub + 6);
        const segCount = segX2 / 2;
        const endO = sub + 14;
        const startO = endO + segX2 + 2;
        const deltaO = startO + segX2;
        const rangeO = deltaO + segX2;
        for (let s = 0; s < segCount; s++) {
            const end = sfnt.readUInt16BE(endO + s * 2);
            if (cp > end) continue;
            const start = sfnt.readUInt16BE(startO + s * 2);
            if (cp < start) return false;
            const delta = sfnt.readUInt16BE(deltaO + s * 2);
            const rangeOffset = sfnt.readUInt16BE(rangeO + s * 2);
            if (rangeOffset === 0) return ((cp + delta) & 0xffff) !== 0;
            return sfnt.readUInt16BE(rangeO + s * 2 + rangeOffset + (cp - start) * 2) !== 0;
        }
        return false;
    }
    if (format === 12) {
        const nGroups = sfnt.readUInt32BE(sub + 12);
        for (let g = 0; g < nGroups; g++) {
            const go = sub + 16 + g * 12;
            if (cp >= sfnt.readUInt32BE(go) && cp <= sfnt.readUInt32BE(go + 4)) return true;
        }
        return false;
    }
    throw new Error(`неподдержанный формат cmap: ${format}`);
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

    it('[data-outcome] переключает --accent на исход боя (победа/поражение)', () => {
        const css = readGlobalsCss();
        const victory = css.match(/\[data-outcome=['"]victory['"]\]\s*{([^}]*)}/)?.[1];
        const defeat = css.match(/\[data-outcome=['"]defeat['"]\]\s*{([^}]*)}/)?.[1];

        expect(victory).toBeDefined();
        expect(victory).toMatch(/--accent:\s*var\(--color-success\)/);
        expect(defeat).toBeDefined();
        expect(defeat).toMatch(/--accent:\s*var\(--color-danger\)/);
        expect(defeat).toMatch(/--accent-ink:\s*var\(--color-danger-ink\)/);
    });

    it('[data-intensity="calm"] глушит все glow до прозрачного no-op', () => {
        const css = readGlobalsCss();
        const calm = css.match(/\[data-intensity=['"]calm['"]\]\s*{([^}]*)}/)?.[1];

        expect(calm).toBeDefined();
        // none в списке box-shadow невалидно — гасим прозрачной тенью, не none.
        expect(calm).not.toMatch(/--glow[a-z-]*:\s*none/);
        expect(calm).toMatch(/--glow:\s*0 0 0 transparent/);
        expect(calm).toMatch(/--glow-text:\s*0 0 0 transparent/);
        // Каждая именованная glow-переменная должна гаситься — иначе прямой потребитель
        // (напр. danger-кнопка через var(--glow-danger)) продолжит светиться в calm-режиме.
        expect(calm).toMatch(/--glow-accent:\s*0 0 0 transparent/);
        expect(calm).toMatch(/--glow-primary:\s*0 0 0 transparent/);
        expect(calm).toMatch(/--glow-enemy:\s*0 0 0 transparent/);
        expect(calm).toMatch(/--glow-danger:\s*0 0 0 transparent/);
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

    it('содержит все именованные glow-эффекты (accent, primary, enemy, danger)', () => {
        const css = readGlobalsCss();

        expect(css).toMatch(/--glow-accent:/);
        expect(css).toMatch(/--glow-primary:/);
        expect(css).toMatch(/--glow-enemy:/);
        expect(css).toMatch(/--glow-danger:/);
    });

    it('[data-outcome="defeat"] переопределяет --glow на glow-danger, обеспечивая синхронизацию токенов', () => {
        const css = readGlobalsCss();
        const defeatBlock = css.match(/\[data-outcome=['"]defeat['"]\]\s*{([^}]*)}/)?.[1];

        expect(defeatBlock).toBeDefined();
        expect(defeatBlock).toMatch(/--glow:\s*var\(--glow-danger\)/);
    });

    it('содержит шрифтовые токены дизайн-системы (DotGothic16 + JetBrains Mono)', () => {
        const css = readGlobalsCss();

        expect(css).toMatch(/--font-display:\s*'DotGothic16'/);
        expect(css).toMatch(/--font-ui:\s*'JetBrains Mono'/);
    });

    it('подключает DotGothic16 и JetBrains Mono self-hosted (latin + cyrillic)', () => {
        const css = readGlobalsCss();

        expect(css).toMatch(
            /font-family:\s*'DotGothic16'[\s\S]*?url\('\/fonts\/dotgothic16-latin\.woff2'\)/,
        );
        expect(css).toMatch(
            /font-family:\s*'DotGothic16'[\s\S]*?url\('\/fonts\/dotgothic16-cyrillic\.woff2'\)/,
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

describe('дизайн-система: файлы дисплейного шрифта DotGothic16 (не только @font-face URL)', () => {
    it('latin- и cyrillic-сабсеты — валидные woff2 и НЕ идентичны (не дубль одного файла)', () => {
        const latin = readFont('dotgothic16-latin.woff2');
        const cyrillic = readFont('dotgothic16-cyrillic.woff2');

        expect(latin.slice(0, 4).toString('latin1')).toBe('wOF2');
        expect(cyrillic.slice(0, 4).toString('latin1')).toBe('wOF2');
        // Именно дубликат (одинаковый sha256) прошёл прошлый CI зелёным — сторожим это.
        expect(latin.equals(cyrillic)).toBe(false);
    });

    it('latin-сабсет содержит базовую латиницу в cmap и осмысленный набор глифов', () => {
        const font = decodeWoff2(readFont('dotgothic16-latin.woff2'));

        expect(numGlyphs(font)).toBeGreaterThan(50); // битый сабсет имел 17
        expect(cmapHas(font, 0x41)).toBe(true); // 'A'
        expect(cmapHas(font, 0x61)).toBe(true); // 'a'
    });

    it('cyrillic-сабсет содержит базовую кириллицу в cmap и осмысленный набор глифов', () => {
        const font = decodeWoff2(readFont('dotgothic16-cyrillic.woff2'));

        expect(numGlyphs(font)).toBeGreaterThan(50);
        expect(cmapHas(font, 0x410)).toBe(true); // 'А'
        expect(cmapHas(font, 0x44f)).toBe(true); // 'я'
    });
});
