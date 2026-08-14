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

        // Усечение ника задаётся ЧИСТО CSS (`max-w-[6ch]` / `md:max-w-[16ch]` +
        // `text-ellipsis`, hp-bar.tsx): многоточие рисует браузер, в textContent оно не
        // попадает и строку не режет. Поэтому проверка усечения — замер бокса
        // (`scrollWidth > clientWidth`), а не сравнение текста: прежний ассерт
        // `not.toContain('…')` не мог упасть никогда и был зелёным на 390, где ник
        // визуально обрезан ровно так, как #540 и запрещает на больших экранах.
        test('ник не усекается на больших экранах (#540)', async ({ page }) => {
            await page.goto('/game?seed=42');

            const hud = page.getByTestId('top-hud');
            await expect(hud).toBeVisible();

            // Только ВИДИМЫЕ ники: `top-hud` держит смонтированными все раскладки сразу
            // (мобильную, планшетную, широкую), и на любом вьюпорте в нём больше десятка
            // узлов `hp-name`, из которых показан лишь свой. Скрытые в выборке ломают
            // проверку насквозь: у них `clientWidth === 0`, то есть `scrollWidth >
            // clientWidth` истинно всегда — «ник усечён» на любой ширине экрана.
            // Скоупа контейнером мало: внутри десктопной полосы вариантов тоже несколько.
            const names = page.locator('[data-testid="top-hud"] [data-testid="hp-name"]:visible');
            // Гвард от vacuous pass: сменится разметка или плейсхолдер — `.all()`
            // вернёт пустой список, цикл не выполнится, и тест был бы зелёным впустую.
            await expect(names.first()).toBeVisible();
            const boxes = await names.all();
            expect(boxes.length).toBeGreaterThan(0);

            const seen: string[] = [];
            for (const box of boxes) {
                seen.push((await box.textContent())?.trim() ?? '');
                const clipped = await box.evaluate((el) => el.scrollWidth > el.clientWidth);
                if (viewport.width >= 1024) {
                    // 16ch против «Rex Commander» (13) и «Terminator» (10) — клипа нет ни у
                    // одного из двух ников.
                    expect(clipped).toBe(false);
                } else if (viewport.width >= 768) {
                    // 768 — ФАКТ, а не спека: ник сжат до 25px при содержимом 104px, потому
                    // что первый ряд отдаёт ширину пилюле и иконкам, а `min-w-0` разрешает
                    // HP-карточке схлопнуться (issue #561; докблок `HpName` пока обещает
                    // обратное). Фиксируем как есть: почините вёрстку — тест покраснеет и
                    // напомнит обновить ожидание, а не тихо разойдётся с реальностью.
                    expect(clipped).toBe(true);
                } else {
                    // На мобилке лимит 6ch, и оба ника длиннее: усечение здесь ОЖИДАЕМО и
                    // является спекой, а не дефектом — фиксируем, чтобы правка ширины не
                    // прошла молча.
                    expect(clipped).toBe(true);
                }
            }
            // Ники в ряду ДВА — свой и бота, и ассертить один и тот же текст на каждом узле
            // нельзя (на этом тест и падал). Проверяем, что длинный ник игрока — тот самый,
            // ради которого заведён #540, — вообще присутствует в выборке.
            expect(seen).toContain('Rex Commander');
        });
    });
}

// Узкий xl (#489): телеметрия (`top-hud-telemetry-desktop`) — нешринкающийся
// (`xl:shrink-0`) ряд, сосед по флекс-ряду с HP-блоком (`flex-1`) — тот
// подстраивается под доступную ширину, а телеметрия нет. Прежний гвард
// (`top-hud`, `scrollWidth`) баг не ловил: `top-hud` — абсолютный оверлей на всю
// ширину вьюпорта (её `right` всегда равен viewport.width), а клип держит
// `scrollWidth` равным вьюпорту — контент не скроллится, просто вылезает за край.
//
// Всего два вьюпорта, не пять: HUD-полоса — `xl:max-w-[1280px] xl:mx-auto`, то есть
// при любой ширине ≥1280 контейнер ровно 1280 и центрован, а внутренняя раскладка
// одна и та же. Правый край телеметрии против вьюпорта фальсифицируем ТОЛЬКО на 1280
// (край контейнера = край вьюпорта); на 1300…1500 у контейнера появляются поля, и
// `x+width ≤ width` тривиально истинно — проверка нефальсифицируема. Реальный клип
// (перенос ряда телеметрии на вторую строку) ловит ассерт высоты полосы `toBe(78)`,
// одинаковый на всех ширинах. Поэтому 1280 (значимый правый край + высота) + один
// широкий (1500 — что центровка/max-width держатся и высота остаётся 78).
for (const width of [1280, 1500]) {
    test.describe(`Верхний HUD — телеметрия не клипается на узком xl (${width})`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('правый край телеметрии не уезжает за вьюпорт, ряд не переносится', async ({
            page,
        }) => {
            await page.goto('/game?seed=42');

            const telemetry = page.getByTestId('top-hud-telemetry-desktop');
            await expect(telemetry).toBeVisible();
            const telemetryBox = await telemetry.boundingBox();
            expect(telemetryBox).not.toBeNull();
            if (telemetryBox) {
                expect(telemetryBox.x + telemetryBox.width).toBeLessThanOrEqual(width);
            }

            // Полоса HUD остаётся высотой 78px (xl:h-[78px]) — перенос ряда
            // телеметрии на вторую строку раздул бы её.
            const desktopHud = page.getByTestId('top-hud-desktop');
            const desktopBox = await desktopHud.boundingBox();
            expect(desktopBox).not.toBeNull();
            if (desktopBox) {
                expect(Math.round(desktopBox.height)).toBe(78);
            }
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

// Планшет 768, ход бота (ревью фазы 4): проверяем, что бейдж заморозки НЕ растит
// полосу HUD. Замер: первый ряд `flex-wrap` на 768 уже переносится сам по себе —
// пилюля резервирует ширину под «ХОД СОПЕРНИКА» (~221px, #449), и HP-блок
// (`min-w-[420px] flex-1`) + пилюля выбирают всю строку 716px, поэтому иконки
// mute/пауза висят на второй строке и БЕЗ бейджа (так же на main). Бейдж (112px,
// ниже иконок) встаёт на ту же вторую строку РЯДОМ с иконками, не создавая третьей
// и не поднимая высоту строки (max(бейдж, иконки) = высота иконок). Барьер, значит,
// не «всё в один ряд» (недостижимо при широкой пилюле), а: (1) бейдж делит строку
// с иконками — не порождает новую; (2) высота полосы одинакова на своём ходу
// (бейдж `invisible`, слот зарезервирован) и на ходе бота (бейдж виден) — появление
// бейджа не добавляет ни пикселя. Скриншот 768 (ход бота) — для гейта вкуса.
test.describe('Верхний HUD — планшет 768, бейдж заморозки не растит полосу', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    async function iconRowBox(page: Page) {
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

    test('бейдж делит строку с иконками, высота полосы одинакова на своём ходу и на ходе бота', async ({
        page,
    }) => {
        test.setTimeout(60_000);
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('top-hud-desktop')).toBeVisible();

        // Свой ход: бейдж зарезервирован (invisible), слот держит геометрию.
        const ownTurnHeight = await hudHeight(page);

        await reachBotTurn(page);
        const badge = page.getByTestId('top-hud-desktop').getByTestId('freeze-badge');
        await expect(badge).toBeVisible();
        const badgeBox = await badge.boundingBox();
        if (!badgeBox) throw new Error('бейдж заморозки не найден');

        // Бейдж встал на строку иконок (делит её вертикальный диапазон), а не создал
        // новую строку выше/ниже — иначе полоса выросла бы.
        expect(
            shareLine(badgeBox, await iconRowBox(page)),
            'ход бота: бейдж заморозки делит строку с кнопками mute/пауза',
        ).toBe(true);

        // Появление бейджа не добавило высоты: слот зарезервирован всегда, поэтому
        // «свой ход» (бейдж invisible) и «ход бота» (бейдж виден) — одна высота.
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
