import { test, expect } from '@playwright/test';
import { reachBotTurn } from './helpers';

// Канонические вьюпорты проекта (CLAUDE.md «Адаптив») + планшет (целевое устройство
// раскладки палубы, issue #424, три состава: мобилка/планшет/десктоп) + лендскейп —
// экран играется в ландшафте на телефоне тоже (ralph.project.md «UI-задачи»).
const VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'landscape-667x375', width: 667, height: 375 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'wide-1920', width: 1920, height: 1080 },
];

for (const viewport of VIEWPORTS) {
    test.describe(`Палуба — ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('видна целиком, без горизонтального переполнения', async ({ page }) => {
            await page.goto('/game?seed=42');

            const deck = page.getByTestId('game-hud');
            await expect(deck).toBeVisible();

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
            expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

            const deckBox = await deck.boundingBox();
            expect(deckBox).not.toBeNull();
            if (deckBox) {
                expect(deckBox.x).toBeGreaterThanOrEqual(0);
                expect(deckBox.x + deckBox.width).toBeLessThanOrEqual(viewport.width);
            }

            await page.screenshot({
                path: `screenshots/bottom-deck-${viewport.name}.png`,
                fullPage: false,
            });
        });
    });
}

// Ход бота на десктопе: палуба переходит в недоступное состояние (кнопки disabled).
// Стартовый ход игрока это не покрывает — отдельный сценарий с turn='enemy'
// проверяет, что смена состояния не ломает раскладку и не переполняет по ширине.
test.describe('Палуба — ход бота (desktop-1280)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('видна целиком и не переполняет по ширине на ходе бота', async ({ page }) => {
        test.setTimeout(60_000);
        await page.goto('/game?seed=42');
        await reachBotTurn(page);

        const deck = page.getByTestId('game-hud');
        await expect(deck).toBeVisible();

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

        const deckBox = await deck.boundingBox();
        expect(deckBox).not.toBeNull();
        if (deckBox) {
            expect(deckBox.x).toBeGreaterThanOrEqual(0);
            expect(deckBox.x + deckBox.width).toBeLessThanOrEqual(1280);
        }

        await page.screenshot({
            path: 'screenshots/bottom-deck-bot-turn-desktop-1280.png',
            fullPage: false,
        });
    });
});
