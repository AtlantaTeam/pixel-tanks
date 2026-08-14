import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Барьер #541 (разбор #534, §1 «Сетка и ритм»): шаг 4px, три легальные высоты
 * ячейки {32,44,56}, выравнивание `stretch` вместо `items-center` — в каждом
 * ряду HUD все прямые дети обязаны иметь равный `offsetHeight` из легального
 * набора. До фикса ряды сходились на разнобое (28/34/40/50/52/55/72) — глаз
 * читает лестницу, а не полосу приборов.
 *
 * Легальные зазоры/паддинги — {0,4,8,16}px: шаг решётки {4,8,16} плюс белый
 * список (значения, которые НЕ являются проектным «шагом решётки», а честным
 * нулём — «зазора нет» — или иным осознанным исключением, а не забытым
 * недобитым числом типа 6/10/14).
 */

const LEGAL_HEIGHTS = [32, 44, 56];
const LEGAL_SPACING = [0, 4, 8, 16];

/** Все прямые дети `row` (по видимому боксу — display:none/нулевой размер
 *  пропускаем, это дубль другого брейкпоинта, а не часть текущего ряда). */
async function visibleChildBoxes(row: Locator): Promise<Array<{ width: number; height: number }>> {
    const children = row.locator(':scope > *');
    const count = await children.count();
    const boxes: Array<{ width: number; height: number }> = [];
    for (let i = 0; i < count; i++) {
        const box = await children.nth(i).boundingBox();
        if (box && box.width > 0 && box.height > 0) boxes.push(box);
    }
    return boxes;
}

async function expectEqualLegalHeights(row: Locator, label: string): Promise<void> {
    const boxes = await visibleChildBoxes(row);
    expect(boxes.length, `${label}: должен быть хотя бы один видимый ребёнок`).toBeGreaterThan(0);

    const heights = boxes.map((b) => Math.round(b.height));
    const baseline = heights[0];

    for (const h of heights) {
        expect(h, `${label}: высоты детей ряда должны совпадать — ${heights.join(', ')}px`).toBe(
            baseline,
        );
    }
    expect(
        LEGAL_HEIGHTS,
        `${label}: высота ${baseline}px не входит в легальный набор {32,44,56}`,
    ).toContain(baseline);
}

/** Зазор/паддинг легален, если входит в {0,4,8,16}. Ноль — не «шаг решётки»,
 *  а честное отсутствие отступа (не диагностируется как разнобой). */
function assertLegalSpacing(value: number, label: string): void {
    expect(
        LEGAL_SPACING,
        `${label}: значение ${value}px не входит в легальный набор {0,4,8,16}`,
    ).toContain(value);
}

async function rowGapPadding(
    row: Locator,
): Promise<{ gap: number; paddingTop: number; paddingBottom: number }> {
    return row.evaluate((el) => {
        const cs = getComputedStyle(el);
        const parse = (v: string) => Math.round(parseFloat(v) || 0);
        return {
            gap: parse(cs.rowGap || cs.gap),
            paddingTop: parse(cs.paddingTop),
            paddingBottom: parse(cs.paddingBottom),
        };
    });
}

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORTS = [
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'wide-1920', width: 1920, height: 1080 },
];

test.describe('Ритм сетки HUD (#541) — mobile-390', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test('три ряда мобильного HUD — равная легальная высота детей', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('top-hud-mobile')).toBeVisible();

        await expectEqualLegalHeights(page.getByTestId('top-hud-mobile-hp-row'), 'моб. ряд 1 (HP)');
        await expectEqualLegalHeights(
            page.getByTestId('top-hud-mobile-status-row'),
            'моб. ряд 2 (статус хода)',
        );
        await expectEqualLegalHeights(
            page.getByTestId('top-hud-mobile-telemetry-row'),
            'моб. ряд 3 (телеметрия)',
        );
    });

    test('зазоры/паддинги рядов мобильного HUD — легальный набор', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('top-hud-mobile')).toBeVisible();

        for (const testId of [
            'top-hud-mobile-hp-row',
            'top-hud-mobile-status-row',
            'top-hud-mobile-telemetry-row',
        ]) {
            const row = page.getByTestId(testId);
            const { gap } = await rowGapPadding(row);
            assertLegalSpacing(gap, `${testId}: gap`);
        }

        const container = await rowGapPadding(page.getByTestId('top-hud-mobile'));
        assertLegalSpacing(container.gap, 'top-hud-mobile: gap между рядами');
    });
});

for (const viewport of DESKTOP_VIEWPORTS) {
    test.describe(`Ритм сетки HUD (#541) — ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('статус-ряд и телеметрия — равная легальная высота детей', async ({ page }) => {
            await page.goto('/game?seed=42');
            await expect(page.getByTestId('top-hud-desktop')).toBeVisible();

            await expectEqualLegalHeights(
                page.getByTestId('top-hud-status-row'),
                'статус-ряд (HP+статус)',
            );
            await expectEqualLegalHeights(
                page.getByTestId('top-hud-telemetry-desktop'),
                'телеметрия (числа+ресурсы)',
            );
            await expectEqualLegalHeights(
                page.getByTestId('top-hud-status-cluster'),
                'кластер статуса (пилюля/бейдж/иконки)',
            );
            await expectEqualLegalHeights(
                page.getByTestId('top-hud-telemetry-numbers'),
                'телеметрия — числа (угол/сила/ветер)',
            );
            await expectEqualLegalHeights(
                page.getByTestId('top-hud-telemetry-resources'),
                'телеметрия — ресурсы (снаряды/ходы)',
            );
        });

        test('статус-ряд и телеметрия выровнены `stretch`, не `items-center`', async ({ page }) => {
            await page.goto('/game?seed=42');
            await expect(page.getByTestId('top-hud-desktop')).toBeVisible();

            for (const testId of [
                'top-hud-status-row',
                'top-hud-status-cluster',
                'top-hud-telemetry-desktop',
                'top-hud-telemetry-numbers',
                'top-hud-telemetry-resources',
            ]) {
                const alignItems = await page
                    .getByTestId(testId)
                    .evaluate((el) => getComputedStyle(el).alignItems);
                // Именно растяжение, а не «что угодно кроме center»: прежний ассерт
                // `not.toBe('center')` пропускал flex-start / baseline / end, то есть
                // не сторожил обещанное заголовком. `normal` — дефолт флекс-контейнера,
                // растягивает так же, как явный `stretch`, поэтому годятся оба.
                expect(['stretch', 'normal'], `${testId}: align-items`).toContain(alignItems);
            }
        });
    });
}

/** #541 критерий готовности: высота HUD не выросла — 174 (мобилка, ceiling
 *  проекта) и 78 (десктопная полоса xl, уже зафиксирована `xl:h-[78px]` и
 *  проверена `top-hud-viewports.spec.ts`, здесь дублируем как явный барьер
 *  бюджета этой задачи). */
test.describe('Бюджет высоты HUD не вырос (#541) — мобилка (390)', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test('высота top-hud ≤174px', async ({ page }) => {
        await page.goto('/game?seed=42');
        const box = await page.getByTestId('top-hud').boundingBox();
        if (!box) throw new Error('top-hud не найден');
        expect(box.height, `высота top-hud = ${box.height}px`).toBeLessThanOrEqual(174);
    });
});

test.describe('Бюджет высоты HUD не вырос (#541) — десктоп xl (1280)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('полоса top-hud-desktop = 78px', async ({ page }: { page: Page }) => {
        await page.goto('/game?seed=42');
        const box = await page.getByTestId('top-hud-desktop').boundingBox();
        if (!box) throw new Error('top-hud-desktop не найден');
        expect(Math.round(box.height)).toBe(78);
    });
});
