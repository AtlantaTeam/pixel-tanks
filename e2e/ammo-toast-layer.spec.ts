import { test, expect, type Page } from '@playwright/test';
import { fireOne, weaponCount } from './helpers';

/**
 * #448 — тост «патроны кончились» смонтирован собственным слоем поверх арены
 * (`views/game-page`), а не DOM-потомком палубы: барьер вмораживает вердикт,
 * что появление тоста не двигает деку и что его позиция — константа от
 * арены/safe-area, одинаковая на всех трёх канонических вьюпортах, а не
 * `bottom-full` меняющегося по составу контейнера деки.
 *
 * Одна последовательная сессия на все три вьюпорта (не три отдельных теста):
 * `fullyParallel` разводит тесты по воркерам-процессам, где модульный
 * аккумулятор расстояний не был бы общим — сравнение внутри одного теста
 * снимает этот класс гонки.
 */

const VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
];

/** Доводит бой до момента, когда у игрока кончился боезапас (тот же прицел,
 *  что и в `battle-states-viewports.spec.ts`: ствол к −45°, немного мощности). */
async function fireUntilEmptyAmmo(page: Page): Promise<void> {
    await expect(page.getByTestId('game-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);
    let count = await weaponCount(page);
    for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');

    while (count > 0) {
        count = await fireOne(page, () => page.keyboard.press('Space'), count, 60_000);
    }
}

test('тост «патроны кончились» — свой слой поверх арены на 390/768/1280', async ({ page }) => {
    test.setTimeout(360_000);

    const distancesFromBottom: number[] = [];

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/game?seed=42');

        const deckBoxBefore = await page.getByTestId('game-hud').boundingBox();
        expect(deckBoxBefore).not.toBeNull();

        await fireUntilEmptyAmmo(page);

        const toast = page.getByRole('status');
        await expect(toast).toBeVisible({ timeout: 90_000 });
        await expect(toast).toContainText('Патроны кончились');

        // Появление тоста не сдвинуло деку (0 px) — тост не её DOM-потомок.
        const deckBoxAfter = await page.getByTestId('game-hud').boundingBox();
        expect(deckBoxAfter).toEqual(deckBoxBefore);

        // Тост не перехватывает клики по арене/палубе (pointer-events-none обёртки).
        const toastBox = await toast.boundingBox();
        expect(toastBox).not.toBeNull();
        if (toastBox) {
            const center = [toastBox.x + toastBox.width / 2, toastBox.y + toastBox.height / 2];
            const hitsToast = await page.evaluate(
                ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="status"]') !== null,
                center,
            );
            expect(hitsToast).toBe(false);

            distancesFromBottom.push(viewport.height - (toastBox.y + toastBox.height));
        }

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
    }

    // Позиция от арены/safe-area — одна и та же на всех трёх вьюпортах, независимо
    // от того, что состав деки (мобилка/планшет/десктоп) на каждом свой.
    for (const distance of distancesFromBottom) {
        expect(distance).toBe(distancesFromBottom[0]);
    }
});
