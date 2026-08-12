import { test, expect } from '@playwright/test';
import { expectGameOverDialog, reachBotTurn } from './helpers';

// Канонические вьюпорты проекта (CLAUDE.md «Адаптив») — состояния хода бота
// (лок + маджента-рамка арены) и game-over проверяем на всех четырёх (issue #426).
const VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'wide-1920', width: 1920, height: 1080 },
];

for (const viewport of VIEWPORTS) {
    test.describe(`Лок ввода — ход бота (${viewport.name})`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('оверлей палубы и маджента-рамка арены видны, без переполнения', async ({ page }) => {
            test.setTimeout(60_000);
            await page.goto('/game?seed=42');
            await reachBotTurn(page);

            await expect(page.getByTestId('deck-lock')).toBeVisible();
            await expect(page.getByTestId('arena-turn-ring')).toBeVisible();

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
            expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

            await page.screenshot({
                path: `screenshots/deck-lock-bot-turn-${viewport.name}.png`,
                fullPage: false,
            });
        });
    });

    test.describe(`Game over — ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('диалог: одна залитая кнопка, индикатор хода скрыт, без переполнения', async ({
            page,
        }) => {
            test.setTimeout(120_000);
            await page.goto('/game?seed=42');
            await expect(page.getByTestId('game-hud')).toBeVisible();

            // Стреляем без прицеливания (текущий угол/сила) — быстрее всего доводит
            // бой до конца, точность выстрела здесь не важна.
            for (let shots = 0; shots < 5; shots++) {
                await page.keyboard.press('Space');
                await page.waitForTimeout(1500);
            }

            await expectGameOverDialog(page);

            const dialog = page.getByRole('dialog');
            const filledButtons = dialog.locator('button.bg-primary');
            await expect(filledButtons).toHaveCount(1);
            await expect(filledButtons).toHaveText(/Реванш/);

            // Пилюля хода — только в HUD-оверлеях, не в самом диалоге; после конца
            // боя она скрыта целиком (handoff «Game over»).
            await expect(page.getByText('ТВОЙ ХОД')).not.toBeVisible();
            await expect(page.getByText('ХОД СОПЕРНИКА')).not.toBeVisible();

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
            expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

            await page.screenshot({
                path: `screenshots/game-over-${viewport.name}.png`,
                fullPage: false,
            });
        });
    });
}

test.describe('Доступность движения — prefers-reduced-motion', () => {
    test.use({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });

    test('лок ввода не крутит blink-анимацию маркера', async ({ page }) => {
        test.setTimeout(60_000);
        await page.goto('/game?seed=42');
        await reachBotTurn(page);

        const marker = page.getByTestId('deck-lock').locator('.animate-lock-blink');
        await expect(marker).toBeVisible();
        const animationName = await marker.evaluate((el) => getComputedStyle(el).animationName);
        expect(animationName).toBe('none');
    });
});
