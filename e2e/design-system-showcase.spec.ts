import { test, expect } from '@playwright/test';

const VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'wide-1920', width: 1920, height: 1080 },
];

for (const viewport of VIEWPORTS) {
    test.describe(`витрина /design-system на ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('рендерится без ошибок консоли и горизонтального скролла', async ({ page }) => {
            const consoleErrors: string[] = [];
            page.on('console', (msg) => {
                if (msg.type() === 'error') {
                    consoleErrors.push(msg.text());
                }
            });
            page.on('pageerror', (err) => {
                consoleErrors.push(String(err));
            });

            await page.goto('/design-system');

            await expect(page.getByTestId('ds-faction-scope')).toBeVisible();

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
            expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

            expect(consoleErrors).toEqual([]);

            await page.screenshot({
                path: `screenshots/design-system-${viewport.name}.png`,
                fullPage: true,
            });
        });
    });
}

test.describe('Доступность движения — prefers-reduced-motion', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    // Переехал из `battle-states-viewports.spec.ts`: после #539 blink-маркер
    // остался только здесь, на кадре витрины «ход соперника» (`DeckLockOverlay`).
    // Сторожим ту же связку `@utility animate-lock-blink` + `motion-reduce:animate-none`,
    // просто в единственном месте, где она теперь рисуется.
    test('blink-маркер лока не крутит анимацию', async ({ page }) => {
        // `test.use({ reducedMotion })` не типизирован в PlaywrightTestOptions этой
        // версии (только `contextOptions`/`page.emulateMedia`) — эмулируем медиа-запрос
        // напрямую на странице, эквивалентно контексту с `reducedMotion: 'reduce'`.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/design-system');

        const marker = page.locator('.animate-lock-blink').first();
        await expect(marker).toBeVisible();
        const animationName = await marker.evaluate((el) => getComputedStyle(el).animationName);
        expect(animationName).toBe('none');
    });
});
