import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Барьер #566: ячейка ресурсов («Снаряды»/«Ходы») верхней панели обязана нести
 * тот же горизонтальный паддинг, что соседние ячейки телеметрии («Угол»/«Сила»/
 * «Ветер») — везде, где бюджет ширины полосы не жмёт.
 *
 * История: паддинг гасился флагом `tight` (#528/#489) ради узкого xl (1280), где
 * телеметрия — нешринкающийся ряд. Флаг применялся на ВСЕХ ширинах, и на 1440/1920
 * ячейка стояла впритык к рамке при соседях с 4px — читалось как поломка вёрстки.
 * Первая правка (#574) свела `tight` к `xl:px-0`, но `xl` в tailwind — это
 * min-width 1280, то есть 1440 и 1920 остались без паддинга: замер (14.08.2026)
 * дал 0px против 4px у соседей. Отсюда два независимых ассерта в этом файле:
 * равенство паддингов на широких кадрах И укладка ряда на каждом кадре пакета —
 * чинить первое, ломая второе, барьер не даст.
 */

/** Кадры, где паддинг ячейки ресурсов сверяется с соседями. 768 — планшет: там
 *  паддинг совпадал и до правки, держим как защиту от «починили xl, уронили md». */
const PARITY_FRAMES = [768, 1440, 1920];

/** Полный пакет кадров проекта (CLAUDE.md «Адаптив») + 320 (самый узкий телефон,
 *  #537) и 1440 (типовой десктоп, на котором дефект и заметили). */
const FRAMES = [320, 390, 768, 1280, 1440, 1920];

/** Горизонтальные паддинги элемента, округлённые до целых пикселей. */
async function paddingX(cell: Locator): Promise<{ left: number; right: number }> {
    return cell.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
            left: Math.round(parseFloat(cs.paddingLeft) || 0),
            right: Math.round(parseFloat(cs.paddingRight) || 0),
        };
    });
}

/** Видимые прямые дети контейнера. Скрытые пропускаем осознанно: составы всех
 *  брейкпоинтов смонтированы всегда («Снаряды» на xl скрыты `xl:hidden`, #548),
 *  и мерить у них паддинг — мерить чужой брейкпоинт. */
async function visibleChildren(container: Locator): Promise<Locator[]> {
    const children = container.locator(':scope > *');
    const count = await children.count();
    const visible: Locator[] = [];
    for (let i = 0; i < count; i++) {
        const child = children.nth(i);
        const box = await child.boundingBox();
        if (box && box.width > 0 && box.height > 0) visible.push(child);
    }
    return visible;
}

/** Ряд телеметрии своего брейкпоинта: ниже 768 — мобильный, дальше — десктопный.
 *  Оба смонтированы всегда, поэтому выбор по ширине, а не по `:visible`-выборке. */
function telemetryRow(page: Page, width: number): Locator {
    return page.getByTestId(
        width < 768 ? 'top-hud-mobile-telemetry-row' : 'top-hud-telemetry-desktop',
    );
}

for (const width of PARITY_FRAMES) {
    test.describe(`Паддинг ячейки ресурсов (#566) — ${width}`, () => {
        test.use({ viewport: { width, height: 900 } });

        test('совпадает с паддингом соседних ячеек телеметрии', async ({ page }) => {
            await page.goto('/game?seed=42');
            await expect(page.getByTestId('top-hud-telemetry-desktop')).toBeVisible();

            const neighbours = await visibleChildren(page.getByTestId('top-hud-telemetry-numbers'));
            const resources = await visibleChildren(
                page.getByTestId('top-hud-telemetry-resources'),
            );
            // Гвард от vacuous pass: сменится разметка ряда — списки станут пустыми,
            // и цикл сверки был бы зелёным впустую.
            expect(neighbours.length, 'соседние ячейки телеметрии должны быть видимы').toBe(3);
            expect(resources.length, 'ячейка ресурсов должна быть видима').toBeGreaterThan(0);

            const expected = await paddingX(neighbours[0]);
            for (const neighbour of neighbours.slice(1)) {
                expect(
                    await paddingX(neighbour),
                    'соседи между собой обязаны быть одинаковы — иначе эталон неоднозначен',
                ).toEqual(expected);
            }

            for (const cell of resources) {
                const label = (await cell.textContent())?.trim() ?? '';
                expect(
                    await paddingX(cell),
                    `ячейка ресурсов «${label}» прижата к рамке против соседей`,
                ).toEqual(expected);
            }
        });
    });
}

for (const width of FRAMES) {
    test.describe(`Ряд телеметрии укладывается (#566) — ${width}`, () => {
        test.use({ viewport: { width, height: 900 } });

        test('ряд не переполнен и не выходит за вьюпорт', async ({ page }) => {
            await page.goto('/game?seed=42');
            const row = telemetryRow(page, width);
            await expect(row).toBeVisible();

            const metrics = await row.evaluate((el) => ({
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                right: el.getBoundingClientRect().right,
            }));
            // Ненулевая ширина — гвард от «ряд скрыт, значит всё влезло».
            expect(metrics.clientWidth, 'ряд телеметрии должен быть развёрнут').toBeGreaterThan(0);
            expect(
                metrics.scrollWidth,
                `ряд телеметрии переполнен: ${metrics.scrollWidth} > ${metrics.clientWidth}`,
            ).toBe(metrics.clientWidth);
            expect(Math.ceil(metrics.right), 'правый край ряда за вьюпортом').toBeLessThanOrEqual(
                width,
            );

            const doc = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            }));
            expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
        });
    });
}
