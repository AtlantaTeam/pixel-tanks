import { test, expect } from '@playwright/test';

const VIEWPORTS = [
    { name: 'portrait-375x667', width: 375, height: 667 },
    { name: 'landscape-667x375', width: 667, height: 375 },
];

for (const viewport of VIEWPORTS) {
    test.describe(`мобильный вьюпорт ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test(`нет горизонтального скролла и HUD виден целиком`, async ({ page }) => {
            await page.goto('/game?seed=42');

            const hud = page.getByTestId('game-hud');
            await expect(hud).toBeVisible();

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
            expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

            const hudBox = await hud.boundingBox();
            expect(hudBox).not.toBeNull();
            if (hudBox) {
                expect(hudBox.x).toBeGreaterThanOrEqual(0);
                expect(hudBox.y).toBeGreaterThanOrEqual(0);
                expect(hudBox.x + hudBox.width).toBeLessThanOrEqual(viewport.width);
                expect(hudBox.y + hudBox.height).toBeLessThanOrEqual(viewport.height);
            }

            await page.screenshot({
                path: `screenshots/mobile-viewport-${viewport.name}.png`,
                fullPage: false,
            });
        });
    });
}
