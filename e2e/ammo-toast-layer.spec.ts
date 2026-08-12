import { test, expect, type Page } from '@playwright/test';
import { fireOne, weaponCount } from './helpers';

/**
 * #448 — тост «патроны кончились» смонтирован собственным слоем поверх арены
 * (`views/game-page`), а не DOM-потомком палубы: барьер вмораживает вердикт,
 * что появление тоста не двигает деку и что его позиция — константа от
 * арены/safe-area, одинаковая на всех трёх канонических вьюпортах, а не
 * `bottom-full` меняющегося по составу контейнера деки.
 *
 * #449 добавляет ту же проверку для верхнего HUD (`top-hud`) — тост монтируется
 * между деком и HUD (свой слой поверх арены), но геометрию HUD барьер #447 до
 * этого не сверял с моментом появления тоста: высота и позиция панели обязаны
 * остаться теми же 0px, что и у деки.
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

/** Прицел (тот же, что и в `battle-states-viewports.spec.ts`: ствол к −45°,
 *  немного мощности) и один пристрелочный выстрел — до того, как гонять бой
 *  до нуля патронов. */
async function aimAndFireOnce(page: Page): Promise<number> {
    await expect(page.getByTestId('game-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);
    const count = await weaponCount(page);
    for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
    return fireOne(page, () => page.keyboard.press('Space'), count, 60_000);
}

/** Доводит бой до момента, когда у игрока кончился боезапас. */
async function fireUntilEmptyAmmo(page: Page, startCount: number): Promise<void> {
    let count = startCount;
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

        // Пристрелочный выстрел ПЕРЕД замером «до»: подсказка жеста (#451) живёт в
        // потоке деки только до первого выстрела боя, и её исчезновение меняло бы
        // высоту деки само по себе — независимо от тоста. Замер «до» берём в уже
        // стабильном состоянии (подсказки нет, патроны ещё есть), «после» —
        // когда патроны кончились и вылез тост, обе точки сравнимы 1:1.
        const remaining = await aimAndFireOnce(page);

        const deckBoxBefore = await page.getByTestId('game-hud').boundingBox();
        expect(deckBoxBefore).not.toBeNull();
        const hudBoxBefore = await page.getByTestId('top-hud').boundingBox();
        expect(hudBoxBefore).not.toBeNull();

        await fireUntilEmptyAmmo(page, remaining);

        const toast = page.getByRole('status');
        await expect(toast).toBeVisible({ timeout: 90_000 });
        await expect(toast).toContainText('Патроны кончились');

        // Появление тоста не сдвинуло деку (0 px) — тост не её DOM-потомок.
        const deckBoxAfter = await page.getByTestId('game-hud').boundingBox();
        expect(deckBoxAfter).toEqual(deckBoxBefore);

        // #449: то же самое — верхний HUD (панель телеметрии/HP) не сдвинулся и
        // не поменял высоту, когда тост появился между деком и HUD.
        const hudBoxAfter = await page.getByTestId('top-hud').boundingBox();
        expect(
            hudBoxAfter?.height,
            `${viewport.name}: высота top-hud с тостом ${hudBoxAfter?.height}px vs без тоста ${hudBoxBefore?.height}px (разница ${Math.abs((hudBoxAfter?.height ?? 0) - (hudBoxBefore?.height ?? 0))}px)`,
        ).toBe(hudBoxBefore?.height);
        expect(
            hudBoxAfter?.y,
            `${viewport.name}: top-hud сдвинулся по Y — было ${hudBoxBefore?.y}px, стало ${hudBoxAfter?.y}px`,
        ).toBe(hudBoxBefore?.y);

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

            // Тост не наезжает на деку: его низ выше верха деки текущего брейкпоинта
            // (зазор). `TOAST_BOTTOM_PX` калибрована по самой высокой — мобильной —
            // деке (`MOBILE_DECK_HEIGHT_PX`), поэтому именно на мобилке зазор самый
            // тонкий; вырастет состав/паддинги деки — упадёт здесь, с подсказкой на
            // причину, а не тихо разъедется (пробел, который ловил лишь косвенно).
            const deckTestId = {
                'mobile-390': 'game-deck-mobile',
                'tablet-768': 'game-deck-tablet',
                'desktop-1280': 'game-deck-desktop',
            }[viewport.name] as string;
            const deckBox = await page.getByTestId(deckTestId).boundingBox();
            expect(deckBox).not.toBeNull();
            expect(
                toastBox.y + toastBox.height,
                `${viewport.name}: тост наехал на ${deckTestId} — низ тоста ${toastBox.y + toastBox.height}px, верх деки ${deckBox?.y}px`,
            ).toBeLessThanOrEqual(deckBox?.y ?? 0);

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
