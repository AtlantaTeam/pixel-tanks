import { test, expect, type Page } from '@playwright/test';
import { reachBotTurn } from './helpers';

/**
 * #447 — геометрия верхнего HUD не зависит ни от фазы боя, ни от значений.
 * Барьер вмораживает вердикт: высота панели совпадает между ходом игрока и ходом
 * соперника (максимальный набор менявших высоту факторов — раскрытие ветра пипы→
 * число И появление заметки о заморозке), а координаты кнопок ± не ездят при
 * смене числа знаков в значении.
 *
 * Почему «свой ход vs ход бота» покрывает все четыре состояния из карточки:
 * ход бота = ветер раскрыт (число) + заметка о заморозке (оверлей) — это строгая
 * НАДмножество изменений относительно своего хода (ветер пипами, заметки нет).
 * Полёт (ветер раскрыт, заметки нет) и финал (пилюля скрыта видимостью) —
 * подмножества по составу, а механизмы их стабильности (фикс-бокс ветра, пилюля
 * через `invisible`) закреплены юнит-тестами `top-hud.test.tsx`.
 */

async function topHudHeight(page: Page): Promise<number> {
    const box = await page.getByTestId('top-hud').boundingBox();
    if (!box) throw new Error('top-hud не найден');
    return box.height;
}

// Высоту сверяем на моб (390) и планшете (768) — оба в критериях #447.
const HEIGHT_VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
];

for (const viewport of HEIGHT_VIEWPORTS) {
    test.describe(`Высота HUD стабильна — ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('высота совпадает на ходе игрока и на ходе соперника (0 px)', async ({ page }) => {
            test.setTimeout(60_000);
            await page.goto('/game?seed=42');
            await expect(page.getByTestId('top-hud')).toBeVisible();

            const ownTurnHeight = await topHudHeight(page);

            await reachBotTurn(page);
            await expect(page.getByTestId('arena-turn-ring')).toBeVisible();
            const botTurnHeight = await topHudHeight(page);

            expect(botTurnHeight).toBe(ownTurnHeight);
        });
    });
}

// Ширину телеметрии и координаты кнопок ± проверяем на мобилке (390): именно там
// живут тач-кнопки ± и колонка из рядов (планшет/десктоп — панель без ±).
test.describe('Ширина ячеек и координаты кнопок ± неизменны — mobile-390', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('кнопка «+» угла не ездит при смене числа знаков значения', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();

        const plusButton = page.getByRole('button', { name: 'Угол больше' });
        await expect(plusButton).toBeVisible();

        async function plusButtonX(): Promise<number> {
            const box = await plusButton.boundingBox();
            if (!box) throw new Error('кнопка «+» угла не найдена');
            return box.x;
        }

        // Прогоняем угол через 1 → 2 → 3 знака нажатиями ArrowLeft: координата
        // левого края кнопки «+» обязана остаться неизменной (значение центрируется
        // в зарезервированном под «360°» боксе).
        const samples: number[] = [];
        samples.push(await plusButtonX());
        for (const presses of [5, 45, 120]) {
            for (let i = 0; i < presses; i++) await page.keyboard.press('ArrowLeft');
            samples.push(await plusButtonX());
        }

        for (const x of samples) {
            expect(x).toBe(samples[0]);
        }
    });

    test('обе HP-карточки одинаковой ширины и не зависят от значения', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('top-hud')).toBeVisible();

        // HP-карточки — flex-1: делят ряд поровну, ширина не зависит от числа HP.
        const cards = page.getByTestId('top-hud-mobile').getByRole('progressbar');
        const playerBar = cards.first();
        const enemyBar = cards.nth(1);

        const playerBox = await playerBar.boundingBox();
        const enemyBox = await enemyBar.boundingBox();
        expect(playerBox).not.toBeNull();
        expect(enemyBox).not.toBeNull();
        if (playerBox && enemyBox) {
            expect(Math.round(enemyBox.width)).toBe(Math.round(playerBox.width));
        }
    });
});
