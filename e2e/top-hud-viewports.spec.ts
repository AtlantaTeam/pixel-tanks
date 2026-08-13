import { test, expect, type Page } from '@playwright/test';
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

// Пересекаются ли прямоугольники ТОЛЬКО по вертикали — «на одной строке»:
// пилюля/бейдж/иконки разведены по X, но обязаны делить строку. `boxesOverlap`
// (обе оси) для соседей по строке всегда false, поэтому проверяем ось Y отдельно.
function shareLine(a: { y: number; height: number }, b: { y: number; height: number }): boolean {
    return a.y < b.y + b.height && a.y + a.height > b.y;
}

// Планшет 768, ход бота (ревью фазы 4): бейдж заморозки резервируется ВСЕГДА
// (invisible на своём ходу — держит геометрию), но добавляет ~ширину чипа в
// первый ряд `flex-wrap` (HP-блок `min-w-[420px] flex-1` + пилюля + бейдж +
// иконки). Риск: бейдж «роняет» пилюлю/иконки на отдельную строку и полоса HUD
// становится выше во ВСЕХ фазах равномерно — а равенство высот по фазам
// (`hud-geometry-stable`) равномерный перенос не ловит. Барьер: пилюля хода и
// кнопки mute/пауза остаются на одной строке И на своём ходу, И на ходе бота;
// бейдж встаёт РЯДОМ с пилюлей (та же строка), не под ней; высота полосы между
// фазами не меняется. Скриншот 768 (ход бота) — для человеческого гейта вкуса.
test.describe('Верхний HUD — планшет 768, бейдж заморозки не роняет первый ряд', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    async function pillBox(page: Page) {
        const box = await page
            .getByTestId('top-hud-desktop')
            .getByTestId('turn-pill')
            .boundingBox();
        if (!box) throw new Error('пилюля хода не найдена');
        return box;
    }

    async function pauseBox(page: Page) {
        const box = await page
            .getByTestId('top-hud-desktop')
            .getByRole('button', { name: 'Пауза' })
            .boundingBox();
        if (!box) throw new Error('кнопка «Пауза» не найдена');
        return box;
    }

    async function hudHeight(page: Page) {
        const box = await page.getByTestId('top-hud').boundingBox();
        if (!box) throw new Error('top-hud не найден');
        return box.height;
    }

    test('пилюля и иконки на одной строке (свой ход и ход бота), бейдж рядом с пилюлей, высота полосы стабильна', async ({
        page,
    }) => {
        test.setTimeout(60_000);
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('top-hud-desktop')).toBeVisible();

        // Свой ход: бейдж зарезервирован (invisible), но первый ряд не переносится.
        expect(
            shareLine(await pillBox(page), await pauseBox(page)),
            'свой ход: пилюля хода и кнопка паузы на одной строке',
        ).toBe(true);
        const ownTurnHeight = await hudHeight(page);

        await reachBotTurn(page);
        const badge = page.getByTestId('top-hud-desktop').getByTestId('freeze-badge');
        await expect(badge).toBeVisible();
        const badgeBox = await badge.boundingBox();
        if (!badgeBox) throw new Error('бейдж заморозки не найден');

        // Ход бота: пилюля и иконки по-прежнему на одной строке, бейдж — рядом с
        // пилюлей (та же строка), а не «уронил» её или иконки на вторую.
        expect(
            shareLine(await pillBox(page), await pauseBox(page)),
            'ход бота: пилюля хода и кнопка паузы на одной строке',
        ).toBe(true);
        expect(
            shareLine(await pillBox(page), badgeBox),
            'ход бота: бейдж заморозки на одной строке с пилюлей хода',
        ).toBe(true);

        // Равномерный перенос из-за бейджа рос бы во всех фазах — сверяем высоту
        // полосы «свой ход» vs «ход бота» напрямую (не только равенство по фазам).
        expect(
            Math.round(await hudHeight(page)),
            `высота top-hud: ход бота vs свой ход (${Math.round(ownTurnHeight)}px)`,
        ).toBe(Math.round(ownTurnHeight));

        await page.screenshot({
            path: 'screenshots/top-hud-bot-turn-tablet-768.png',
            fullPage: false,
        });
    });
});
