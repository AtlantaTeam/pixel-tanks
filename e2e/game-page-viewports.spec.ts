import { test, expect } from '@playwright/test';

test.describe('GamePage - Design System Link', () => {
    const viewports = [
        { name: 'mobile-portrait', width: 390, height: 667 },
        { name: 'mobile-landscape', width: 667, height: 390 },
        { name: 'tablet', width: 768, height: 1024 },
        { name: 'desktop', width: 1280, height: 800 },
    ];

    viewports.forEach(({ name, width, height }) => {
        test(`link is visible and accessible on ${name}`, async ({ browser }) => {
            const context = await browser.newContext({
                viewport: { width, height },
            });
            const page = await context.newPage();

            await page.goto('http://localhost:3050/game');

            // Screenshot
            await page.screenshot({
                path: `screenshots/game-page-${name}.png`,
            });

            // Check link exists
            const link = page.getByRole('link', { name: /витрина|showcase/i });
            await expect(link).toBeVisible();

            // Check aria-label
            await expect(link).toHaveAccessibleName(/витрина|showcase/i);

            // Check console for errors
            const messages: string[] = [];
            page.on('console', (msg) => {
                if (msg.type() === 'error') {
                    messages.push(msg.text());
                }
            });

            // Wait for any errors
            await page.waitForTimeout(500);
            expect(messages.length).toBe(0);

            await context.close();
        });
    });
});
