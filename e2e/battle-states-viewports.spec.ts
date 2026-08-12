import { test, expect, type Page } from '@playwright/test';
import { expectGameOverDialog, fireOne, reachBotTurn, weaponCount } from './helpers';

// Канонические вьюпорты проекта (CLAUDE.md «Адаптив») — состояния хода бота
// (лок + маджента-рамка арены) и game-over проверяем на всех четырёх (issue #426).
const VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'wide-1920', width: 1920, height: 1080 },
];

/**
 * Доводит бой до конца клавиатурой: тот же прицел на врага, что и `reachBotTurn`
 * (ствол к −45°, немного мощности), затем стреляет оружием игрока по одному,
 * ожидая каждый раз реальную трату боезапаса (как в `keyboard-battle.spec.ts`) —
 * наивные N выстрелов с фиксированной паузой без прицеливания ненадёжны: часть
 * промахивается мимо врага, и бой не успевает закончиться (было падение теста).
 *
 * `fireOne` ждёт с увеличенным таймаутом (60с вместо дефолтных 30): на широком
 * канвасе (1920) поле шире и снаряд летит дольше — один ход бота (прицел +
 * полёт) может не уложиться в стандартное окно.
 */
async function fireUntilGameOver(page: Page): Promise<void> {
    await expect(page.getByTestId('game-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);
    let count = await weaponCount(page);
    for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');

    while (count > 0) {
        count = await fireOne(page, () => page.keyboard.press('Space'), count, 60_000);
    }
}

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
            test.setTimeout(300_000);
            await page.goto('/game?seed=42');
            await fireUntilGameOver(page);

            // Игрок мог расстрелять весь боезапас без единого попадания (фикс.
            // угол/сила не гарантируют хит на широком канвасе, напр. 1920) — тогда
            // матч доигрывает бот один, дольше стандартных 30с.
            await expectGameOverDialog(page, 90_000);

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
    test.use({ viewport: { width: 1280, height: 800 } });

    test('лок ввода не крутит blink-анимацию маркера', async ({ page }) => {
        test.setTimeout(60_000);
        // `test.use({ reducedMotion })` не типизирован в PlaywrightTestOptions этой
        // версии (только `contextOptions`/`page.emulateMedia`) — эмулируем медиа-запрос
        // напрямую на странице, эквивалентно контексту с `reducedMotion: 'reduce'`.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/game?seed=42');
        await reachBotTurn(page);

        const marker = page.getByTestId('deck-lock').locator('.animate-lock-blink');
        await expect(marker).toBeVisible();
        const animationName = await marker.evaluate((el) => getComputedStyle(el).animationName);
        expect(animationName).toBe('none');
    });
});
