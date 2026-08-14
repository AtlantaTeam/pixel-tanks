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
    test.describe(`Индикаторы хода бота (${viewport.name})`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        // После #539 состояние «ход соперника» несут ровно два индикатора вместо
        // четырёх: плашка хода и маджента-рамка арены. Проверяем оба — именно они
        // и остались контрактом состояния, а снятый `deck-lock` больше не рисуется.
        //
        // Пилюлю берём из полосы СВОЕГО брейкпоинта: мобильная и десктопная
        // смонтированы обе всегда (одна скрыта классом), и нескопленный локатор дал бы
        // strict mode violation на двух узлах. Здесь скоуп ещё и по делу: тест
        // вьюпортный, и проверять он обязан ту пилюлю, которую видит пользователь.
        const hudTestId = viewport.width < 768 ? 'top-hud-mobile' : 'top-hud-desktop';

        test('плашка хода и маджента-рамка арены видны, без переполнения', async ({ page }) => {
            test.setTimeout(60_000);
            await page.goto('/game?seed=42');
            await reachBotTurn(page);

            const turnPill = page.getByTestId(hudTestId).getByTestId('turn-pill');
            await expect(turnPill).toBeVisible();
            await expect(turnPill).toContainText('ХОД СОПЕРНИКА');
            await expect(page.getByTestId('arena-turn-ring')).toBeVisible();

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
            expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

            await page.screenshot({
                path: `screenshots/bot-turn-${viewport.name}.png`,
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
            // боя она скрыта (handoff «Game over»). С #447 пилюля не размонтируется,
            // а прячется видимостью (ряд держит высоту), поэтому в DOM остаётся по
            // копии на моб/десктоп-оверлей — проверяем, что КАЖДАЯ невидима.
            for (const label of ['ТВОЙ ХОД', 'ХОД СОПЕРНИКА']) {
                for (const pill of await page.getByText(label).all()) {
                    await expect(pill).not.toBeVisible();
                }
            }

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

// Проверка `prefers-reduced-motion` для blink-маркера переехала в
// `design-system-showcase.spec.ts`: после #539 маркер остался только на витрине
// (`DeckLockOverlay`), в бою его больше нет. Тест ушёл туда, где живёт предмет.
