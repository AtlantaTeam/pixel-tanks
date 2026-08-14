import { test, expect, type Page } from '@playwright/test';

/**
 * Барьер #554: `Button` собирал классы через `clsx` (простая конкатенация), и
 * базовый `m-1` из `buttonClasses()` при равной специфичности решался порядком
 * правил в СГЕНЕРИРОВАННОМ Tailwind-стиле, а не порядком в атрибуте `class`.
 * Из-за этого `className="m-0"` не гасил отступ: у 13 кнопок (звук/пауза в HUD,
 * кадры витрины) оставался живой `margin: 4px` — ряд «ТВОЙ ХОД» давал 12px между
 * пилюлей и кнопками вместо 8 (`flex gap-2`) и 16px между самими кнопками.
 *
 * Юнит-тест на `buttonClasses()` сторожит строку классов, а этот тест — итог в
 * браузере: то, чем баг мерился при разборе #528. Проверяем ровно две вещи:
 *
 * 1. слияние действительно произошло — в `class` нет одновременно `m-0` и `m-1`
 *    (детерминированный признак возврата к конкатенации, не зависящий от
 *    вёрстки конкретного экрана);
 * 2. computed `margin` таких элементов — `0px`, если вызывающий не задал отступ
 *    другой утилитой (`ml-auto` у «Поделиться реплеем» — задал, такие пропускаем
 *    по классу, а не по значению).
 */

/** Элементы, у которых в `class` есть утилита `m-0`. `ml-auto` и подобные —
 *  осознанный отступ вызывающего, для них проверяем только факт слияния. */
async function collectMarginZeroNodes(page: Page) {
    return page.evaluate(() => {
        const OTHER_MARGIN_RE = /^-?m[trblxyse]-/;
        return [...document.querySelectorAll('*')]
            .map((el) => ({ el, classes: el.className?.toString?.().split(/\s+/) ?? [] }))
            .filter(({ classes }) => classes.includes('m-0'))
            .map(({ el, classes }) => ({
                tag: el.tagName,
                label: (el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 24),
                classes,
                hasBaseMargin: classes.includes('m-1'),
                hasOwnSideMargin: classes.some((c) => OTHER_MARGIN_RE.test(c)),
                margin: getComputedStyle(el).margin,
            }));
    });
}

async function expectMergedMarginZero(page: Page, label: string) {
    const nodes = await collectMarginZeroNodes(page);

    // Гвард от vacuous pass: пропадёт `m-0` из разметки — пустой список сделал бы
    // тест вечно зелёным, а барьер слепым.
    expect(
        nodes.length,
        `${label}: на странице должны быть элементы с утилитой m-0`,
    ).toBeGreaterThan(0);

    for (const node of nodes) {
        expect(
            node.hasBaseMargin,
            `${label}: у «${node.label}» в class остался базовый m-1 рядом с m-0 — классы снова конкатенируются, а не сливаются`,
        ).toBe(false);

        if (!node.hasOwnSideMargin) {
            expect(
                node.margin,
                `${label}: у «${node.label}» computed margin ${node.margin} вместо 0px`,
            ).toBe('0px');
        }
    }
}

test.describe('Кнопки: className="m-0" гасит базовый отступ (#554)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('кнопки звук/пауза в HUD боя не носят паразитных 4px', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('top-hud')).toBeVisible();

        // Точечно — те самые кнопки, замером которых баг и нашли (#528).
        for (const label of ['Выключить звук', 'Пауза']) {
            const button = page.locator(
                `[data-testid="top-hud"] button[aria-label="${label}"]:visible`,
            );
            await expect(button.first()).toBeVisible();
            expect(
                await button.first().evaluate((el) => getComputedStyle(el).margin),
                `кнопка «${label}»: computed margin должен быть 0px`,
            ).toBe('0px');
        }

        await expectMergedMarginZero(page, 'HUD боя');
    });

    test('кадры экранов на витрине не носят паразитных 4px', async ({ page }) => {
        await page.goto('/design-system');
        await expect(page.getByTestId('ds-faction-scope')).toBeVisible();

        await expectMergedMarginZero(page, 'витрина /design-system');
    });
});
