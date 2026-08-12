import { test, expect } from '@playwright/test';
import { reachBotTurn } from './helpers';

// Канонические вьюпорты проекта (CLAUDE.md «Адаптив») + планшет — целевое
// устройство раскладки верхнего HUD (issue #423), пропускать нельзя.
const VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'wide-1920', width: 1920, height: 1080 },
];

for (const viewport of VIEWPORTS) {
    test.describe(`Верхний HUD — ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('виден целиком, без горизонтального переполнения', async ({ page }) => {
            await page.goto('/game?seed=42');

            const hud = page.getByTestId('top-hud');
            await expect(hud).toBeVisible();

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
            expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

            const hudBox = await hud.boundingBox();
            expect(hudBox).not.toBeNull();
            if (hudBox) {
                expect(hudBox.x).toBeGreaterThanOrEqual(0);
                expect(hudBox.x + hudBox.width).toBeLessThanOrEqual(viewport.width);
            }

            await page.screenshot({
                path: `screenshots/top-hud-${viewport.name}.png`,
                fullPage: false,
            });
        });
    });
}

// Ход бота на десктопе: в ряд телеметрии полосы 78px (xl:flex-nowrap) вставляется
// FrozenNote className="w-full" — полноширинный элемент в нерасщепляемом ряду
// способен переполнить раскладку. Стартовый ход игрока это не покрывает (там
// FrozenNote нет), поэтому отдельный сценарий с turn='enemy'.
test.describe('Верхний HUD — ход бота (desktop-1280)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('ряд телеметрии с FrozenNote не переполняет полосу по ширине', async ({ page }) => {
        test.setTimeout(60_000);
        await page.goto('/game?seed=42');
        await reachBotTurn(page);

        const hud = page.getByTestId('top-hud');
        await expect(hud).toBeVisible();

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

        const hudBox = await hud.boundingBox();
        expect(hudBox).not.toBeNull();
        if (hudBox) {
            expect(hudBox.x).toBeGreaterThanOrEqual(0);
            expect(hudBox.x + hudBox.width).toBeLessThanOrEqual(1280);
        }

        await page.screenshot({
            path: 'screenshots/top-hud-bot-turn-desktop-1280.png',
            fullPage: false,
        });
    });
});
