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

/**
 * Нижняя граница поддержки — 320px (#537). До этой спеки её не проверял никто: канонические
 * вьюпорты проекта начинаются с 390, и «приоритет сброса» — четыре элемента, которые прячутся
 * ТОЛЬКО здесь, — держался на одних комментариях. Дважды это кончилось одинаково: класс
 * применяли безусловно, контент пропадал на всех телефонах, и ни один барьер не краснел
 * (кнопки ± — коммит b6e1e32, подписи и ряд «Снаряды» — этот).
 *
 * Отсюда две проверки в паре: на 320 сброс СРАБОТАЛ (панель влезла), на 390 сброшенное
 * ВЕРНУЛОСЬ. Порознь любая из них снова пропустит тот же баг.
 */
test.describe('Нижняя граница 320px — приоритет сброса (#537)', () => {
    test.use({ viewport: { width: 320, height: 640 } });

    test('панель влезает без переполнения, второстепенное схлопнуто', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('top-hud-mobile')).toBeVisible();

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        expect(scrollWidth, 'горизонтального переполнения быть не должно').toBeLessThanOrEqual(
            clientWidth,
        );

        // Схлопнуто по ШИРИНЕ (`w-0 overflow-hidden`), а не размонтировано: узлы остаются
        // в дереве доступности, поэтому меряем бокс, а не наличие.
        const label = page.getByTestId('top-hud-mobile').getByText('Угол', { exact: true });
        expect((await label.boundingBox())?.width ?? 0, 'подпись «Угол» схлопнута').toBe(0);
    });
});

test.describe('390px — сброшенное на 320 возвращается', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('подписи ячеек и кнопки ± видны', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('top-hud-mobile')).toBeVisible();

        const label = page.getByTestId('top-hud-mobile').getByText('Угол', { exact: true });
        expect((await label.boundingBox())?.width ?? 0, 'подпись «Угол» видна').toBeGreaterThan(0);

        const plus = page.getByRole('button', { name: 'Угол больше' });
        expect((await plus.boundingBox())?.width ?? 0, 'кнопка + угла видна').toBeGreaterThan(8);
    });
});
