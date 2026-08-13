import { test, expect } from '@playwright/test';
import { reachBotTurn } from './helpers';

// Канонические вьюпорты проекта (CLAUDE.md «Адаптив») + планшет — целевое
// устройство раскладки верхнего HUD (issue #423), пропускать нельзя.
const VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'wide-1920', width: 1920, height: 1080 },
];

for (const viewport of VIEWPORTS) {
    test.describe(`Верхний HUD — ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('виден целиком, без горизонтального переполнения', async ({ page }) => {
            await page.goto('/game?seed=42');

            const hud = page.getByTestId('top-hud');
            await expect(hud).toBeVisible();

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
            expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

            const hudBox = await hud.boundingBox();
            expect(hudBox).not.toBeNull();
            if (hudBox) {
                expect(hudBox.x).toBeGreaterThanOrEqual(0);
                expect(hudBox.x + hudBox.width).toBeLessThanOrEqual(viewport.width);
            }

            await page.screenshot({
                path: `screenshots/top-hud-${viewport.name}.png`,
                fullPage: false,
            });
        });
    });
}

// Пересекаются ли прямоугольники — используется, чтобы поймать перекрытие
// бейджа заморозки и ряда телеметрии (#472), а не только горизонтальное
// переполнение (это ловит getBoundingClientRect-проверка выше).
function boxesOverlap(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
): boolean {
    return (
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    );
}

// Ход бота на десктопе/широком: бейдж заморозки — короткий чип рядом с пилюлей
// хода (#472, было — FrozenNote className="w-full" absolute-оверлеем внутри
// ряда телеметрии, лежал поверх числовых ячеек на xl, где полоса — 78px без
// запаса под целую строку текста). Стартовый ход игрока это не покрывает (там
// бейджа нет вовсе), поэтому отдельный сценарий с turn='enemy' на каждом из
// двух вьюпортов, где баг был замерен.
for (const width of [1280, 1920]) {
    test.describe(`Верхний HUD — ход бота (desktop-${width})`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('бейдж заморозки не перекрывает телеметрию и не переполняет полосу', async ({
            page,
        }) => {
            test.setTimeout(60_000);
            await page.goto('/game?seed=42');
            await reachBotTurn(page);

            const hud = page.getByTestId('top-hud');
            await expect(hud).toBeVisible();

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
            expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

            const hudBox = await hud.boundingBox();
            expect(hudBox).not.toBeNull();
            if (hudBox) {
                expect(hudBox.x).toBeGreaterThanOrEqual(0);
                expect(hudBox.x + hudBox.width).toBeLessThanOrEqual(width);
            }

            const badge = page.getByTestId('freeze-badge');
            await expect(badge).toBeVisible();
            const telemetry = page.getByTestId('top-hud-telemetry-desktop');
            const badgeBox = await badge.boundingBox();
            const telemetryBox = await telemetry.boundingBox();
            expect(badgeBox).not.toBeNull();
            expect(telemetryBox).not.toBeNull();
            if (badgeBox && telemetryBox) {
                expect(boxesOverlap(badgeBox, telemetryBox)).toBe(false);
            }

            await page.screenshot({
                path: `screenshots/top-hud-bot-turn-desktop-${width}.png`,
                fullPage: false,
            });
        });
    });
}
