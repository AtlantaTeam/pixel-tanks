import { test, expect } from '@playwright/test';

// Страница игры монтирует Canvas и `SceneMusic` (автоплей аудио) — их посторонний шум
// в консоли (заблокированный autoplay, WebGL-варнинг в CI) не относится к ссылке на
// витрину. Отсеиваем его, чтобы падение аудио/канваса не маскировалось под провал
// touch-target; настоящая регрессия ссылки (реальная ошибка) при этом всё равно всплывёт.
const IGNORED_CONSOLE = [
    /autoplay/i,
    /audiocontext/i,
    /play\(\) (request|failed)/i,
    /not allowed to start/i,
    /webgl/i,
    /react devtools/i,
];

const VIEWPORTS = [
    { name: 'mobile-portrait', width: 390, height: 667 },
    { name: 'mobile-landscape', width: 667, height: 390 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 800 },
];

for (const viewport of VIEWPORTS) {
    test.describe(`GamePage — ссылка на витрину · ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('видима, доступна и держит 44px touch target внутри вьюпорта', async ({ page }) => {
            // Слушатель консоли — ДО навигации, иначе ошибки этапа загрузки теряются.
            const consoleErrors: string[] = [];
            page.on('console', (msg) => {
                if (msg.type() === 'error') consoleErrors.push(msg.text());
            });
            page.on('pageerror', (err) => consoleErrors.push(String(err)));

            // Относительный путь — подтягивает baseURL из playwright.config (в CI это порт 3051).
            await page.goto('/game?seed=42');

            // Ссылка переехала в паузу (#423, handoff «Что делать в кодовой базе»):
            // плавающая иконка поверх арены перекрывала верхний HUD. Верхний HUD
            // рендерит два состава (мобилка/десктоп, `md:` брейкпоинт 768px) —
            // берём кнопку паузы из видимого на этом вьюпорте состава.
            const hudTestId = viewport.width >= 768 ? 'top-hud-desktop' : 'top-hud-mobile';
            await page.getByTestId(hudTestId).getByRole('button', { name: 'Пауза' }).click();

            const link = page.getByRole('link', { name: /витрина|showcase/i });
            await expect(link).toBeVisible();
            await expect(link).toHaveAccessibleName(/витрина|showcase/i);

            // Диалог паузы скроллится, когда контент выше короткого вьюпорта
            // (напр. mobile-landscape 390px высотой) — дотягиваемся до ссылки так же,
            // как это сделал бы реальный палец, прежде чем мерить её геометрию.
            await link.scrollIntoViewIfNeeded();

            // Геометрия: ссылка — валидный touch target (≥44px) и не уезжает за край вьюпорта.
            const box = await link.boundingBox();
            expect(box).not.toBeNull();
            if (box) {
                expect(box.width).toBeGreaterThanOrEqual(44);
                expect(box.height).toBeGreaterThanOrEqual(44);
                expect(box.x).toBeGreaterThanOrEqual(0);
                expect(box.y).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
                expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
            }

            await page.screenshot({ path: `screenshots/game-page-${viewport.name}.png` });

            const unexpected = consoleErrors.filter(
                (msg) => !IGNORED_CONSOLE.some((pattern) => pattern.test(msg)),
            );
            expect(unexpected).toEqual([]);
        });
    });
}
