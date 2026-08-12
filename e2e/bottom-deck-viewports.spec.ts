import { test, expect } from '@playwright/test';
import { reachBotTurn, reachFlightPhase, weaponCount } from './helpers';

const GESTURE_HINT_TEXT = 'Тяни по арене — отпусти, чтобы выстрелить';

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

/**
 * Компактная палуба (issue #451): бюджет высоты `game-hud` на 390×844 — ≤175px
 * до первого выстрела боя (с подсказкой жеста) и ≤150px после (подсказка
 * скрыта). Подсказка не возвращается в этом же бою — «показывается заново
 * только в новом бое» уже покрыто unit-тестами стора/палубы (startGame сбрасывает
 * `shotsFired`), здесь — геометрия и живая браузерная разметка, которую unit-тесты
 * не видят.
 */
test.describe('Компактная палуба (#451) — mobile-390', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('высота ≤175px до первого выстрела (с подсказкой), ≤150px после (без)', async ({
        page,
    }) => {
        test.setTimeout(60_000);
        await page.goto('/game?seed=42');

        const deck = page.getByTestId('game-hud');
        await expect(deck).toBeVisible();
        await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);

        await expect(page.getByText(GESTURE_HINT_TEXT)).toBeVisible();
        const beforeBox = await deck.boundingBox();
        if (!beforeBox) throw new Error('game-hud не найден');
        expect(
            beforeBox.height,
            `палуба до первого выстрела: ${beforeBox.height}px, бюджет #451 ≤175px`,
        ).toBeLessThanOrEqual(175);

        await reachFlightPhase(page);

        await expect(page.getByText(GESTURE_HINT_TEXT)).toHaveCount(0);
        const afterBox = await deck.boundingBox();
        if (!afterBox) throw new Error('game-hud не найден');
        expect(
            afterBox.height,
            `палуба после первого выстрела: ${afterBox.height}px, бюджет #451 ≤150px`,
        ).toBeLessThanOrEqual(150);
    });

    test('подсказка не возвращается в этом же бою — держится скрытой на ходе соперника', async ({
        page,
    }) => {
        test.setTimeout(60_000);
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();
        await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);

        await reachFlightPhase(page);
        await expect(page.getByText(GESTURE_HINT_TEXT)).toHaveCount(0);

        await expect(page.getByTestId('arena-turn-ring')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(GESTURE_HINT_TEXT)).toHaveCount(0);
    });

    test('кнопки манёвра/ОГОНЬ и стрелки селектора ≥44×44, зазор ряда манёвра ≥8px', async ({
        page,
    }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();
        await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);

        const mobileDeck = page.getByTestId('game-deck-mobile');
        const left = mobileDeck.getByRole('button', { name: 'Сдвинуть влево' });
        const right = mobileDeck.getByRole('button', { name: 'Сдвинуть вправо' });
        const fire = mobileDeck.getByRole('button', { name: /Огонь/ });
        const prevWeapon = mobileDeck.getByRole('button', { name: 'Предыдущее оружие' });
        const nextWeapon = mobileDeck.getByRole('button', { name: 'Следующее оружие' });

        for (const [name, locator] of [
            ['манёвр влево', left],
            ['манёвр вправо', right],
            ['ОГОНЬ', fire],
            ['селектор ‹', prevWeapon],
            ['селектор ›', nextWeapon],
        ] as const) {
            const box = await locator.boundingBox();
            if (!box) throw new Error(`кнопка «${name}» не найдена`);
            expect(box.width, `«${name}» ширина`).toBeGreaterThanOrEqual(44);
            expect(box.height, `«${name}» высота`).toBeGreaterThanOrEqual(44);
        }

        const leftBox = await left.boundingBox();
        const rightBox = await right.boundingBox();
        const fireBox = await fire.boundingBox();
        if (!leftBox || !rightBox || !fireBox) throw new Error('кнопки ряда манёвра не найдены');

        // Зазор между соседями по ряду ≥8px — через края боксов (кнопки ряда не
        // центрированы симметрично, в отличие от ± телеметрии в top-hud).
        expect(
            rightBox.x - (leftBox.x + leftBox.width),
            'зазор между манёвром влево/вправо',
        ).toBeGreaterThanOrEqual(8);
        expect(
            fireBox.x - (rightBox.x + rightBox.width),
            'зазор между манёвром вправо и ОГОНЬ',
        ).toBeGreaterThanOrEqual(8);
    });
});
