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
 *
 * Ревью #566 сняло с барьера две слепые зоны:
 *
 * 1. в наборе кадров не было 1200 — а `--breakpoint-xl` у нас 1200, и это самый
 *    узкий кадр xl-состава, тот самый, ради которого заводился `tight`;
 * 2. метрика снималась только с РЯДА, который на xl `shrink-0 flex-nowrap`: он
 *    не переполняется, а выдавливается из полосы целиком, рапортуя зелёное
 *    `scrollWidth === clientWidth`. Поэтому теперь мерим и полосу
 *    `top-hud-desktop`, и правый край ряда относительно вьюпорта.
 *
 * Кадр = один `describe` с одним переходом на `/game?seed=42` (ревью #566): раньше
 * пересекающиеся списки кадров давали 18 загрузок страницы на одно правило паддинга.
 * Проверки внутри кадра разведены `test.step` — в отчёте видно, какая упала.
 */

/** Кадры, где паддинг ячеек ряда сверяется между собой. 768 — планшет: там
 *  паддинг совпадал и до правки, держим как защиту от «починили xl, уронили md».
 *  1200 — узкий xl: там ряд идёт плотным ВЕСЬ, и равенство обязано держаться
 *  и в плотном режиме. */
const PARITY_FRAMES = new Set([768, 1200, 1280, 1440, 1920]);

/** Полный пакет кадров проекта (CLAUDE.md «Адаптив») + 320 (самый узкий телефон,
 *  #537), 1200 (начало `xl` при наших брейкпоинтах) и 1440 (типовой десктоп, на
 *  котором дефект и заметили). */
const FRAMES = [320, 390, 768, 1200, 1232, 1280, 1440, 1920];

/** С этой ширины ячейкам возвращается паддинг (`xl-wide:px-1` в `CellShell`,
 *  `--breakpoint-xl-wide` в globals.css) — и с неё же полоса HUD обязана
 *  укладываться целиком. Ниже (1200–1279) у полосы остаётся ОТДЕЛЬНЫЙ, не связанный
 *  с паддингом дефект: левый кластер (HP + пилюля + бейджи + иконки) не ужимается и
 *  переполняет полосу на ≈7–24px даже при нулевом паддинге ячеек. Он заведён
 *  карточкой #592 — сторожить его этим барьером сейчас значило бы держать красный
 *  e2e на чужом дефекте; снятие порога записано в её критерий готовности. */
const STRIP_FITS_FROM = 1280;

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

// Один describe и одна загрузка страницы на кадр (ревью #566): списки кадров
// пересекались, и на одно правило паддинга приходилось 18 переходов `/game?seed=42`
// — гейт мерджа гоняет это на каждый PR. Проверки внутри кадра разведены
// `test.step`, поэтому в отчёте видно, какая именно упала.
for (const width of FRAMES) {
    test.describe(`Полоса телеметрии (#566) — ${width}`, () => {
        test.use({ viewport: { width, height: 900 } });

        test('паддинг ячеек общий, ряд и полоса укладываются', async ({ page }) => {
            await page.goto('/game?seed=42');

            if (PARITY_FRAMES.has(width)) {
                await test.step('паддинг ячейки ресурсов совпадает с соседями', () =>
                    expectPaddingParity(page, width));
            }
            await test.step('ряд не переполнен и не выходит за вьюпорт', () =>
                expectRowFits(page, width));
            // Полоса, а не ряд: метрика ряда слепа к тому, что он выдавлен из полосы
            // целиком (ревью #566). Ниже STRIP_FITS_FROM полосу сторожит не этот
            // барьер — см. комментарий у константы.
            if (width >= STRIP_FITS_FROM) {
                await test.step('полоса HUD укладывается в свою ширину', () =>
                    expectStripFits(page));
            }
        });
    });
}

async function expectPaddingParity(page: Page, width: number) {
    await expect(page.getByTestId('top-hud-telemetry-desktop')).toBeVisible();

    const neighbours = await visibleChildren(page.getByTestId('top-hud-telemetry-numbers'));
    const resources = await visibleChildren(page.getByTestId('top-hud-telemetry-resources'));
    // Гвард от vacuous pass: сменится разметка ряда — списки станут пустыми,
    // и цикл сверки был бы зелёным впустую.
    expect(neighbours.length, 'соседние ячейки телеметрии должны быть видимы').toBe(3);
    expect(resources.length, 'ячейка ресурсов должна быть видима').toBeGreaterThan(0);

    const expected = await paddingX(neighbours[0]);
    // Второй гвард от vacuous pass: с общим для ряда паддингом равенство
    // выполняется и когда паддинга нет вовсе. На кадрах, где он положен
    // (≥ STRIP_FITS_FROM), эталон обязан быть ненулевым — иначе тест
    // молча сторожил бы «одинаково по нулям», а дефект #566 (ячейка
    // впритык к рамке) вернулся бы незамеченным.
    if (width >= STRIP_FITS_FROM) {
        expect(
            expected.left,
            `на ${width} ячейки телеметрии обязаны нести паддинг, а не быть прижатыми к рамке`,
        ).toBeGreaterThan(0);
    }
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
}

async function expectRowFits(page: Page, width: number) {
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
    // Именно этот ассерт ловит вклад паддинга на узком xl: сам ряд там
    // `shrink-0`, внутренним переполнением он не рапортует ничего — зато
    // выезжает правым краем за вьюпорт (замер на 1200: 1229px правого края
    // с паддингом против 1197px без).
    expect(
        Math.ceil(metrics.right),
        `правый край ряда (${Math.ceil(metrics.right)}px) за вьюпортом ${width}px`,
    ).toBeLessThanOrEqual(width);

    // Что это сторожит на самом деле (ревью #566): НЕ переполнение HUD — корень
    // страницы (`main` в `game-page.tsx`) несёт `overflow-hidden`, любое переполнение
    // клипается им и до документа не доходит (замер: на 1200, где полоса переполнена
    // на 7px, и документ, и сам `main` рапортуют «влезло»). Ассерт остаётся сторожем
    // самого клипа: снимут `overflow-hidden` — страница начнёт скроллиться вбок, и он
    // покраснеет. Поэтому меряем и клип явно, а не только его следствие.
    const doc = await page.evaluate(() => {
        const main = document.querySelector('main');
        return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            mainOverflowX: main ? getComputedStyle(main).overflowX : null,
        };
    });
    expect(doc.mainOverflowX, 'корень страницы боя обязан клипать горизонталь').toBe('hidden');
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
}

async function expectStripFits(page: Page) {
    const strip = page.getByTestId('top-hud-desktop');
    await expect(strip).toBeVisible();

    const metrics = await strip.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
    }));
    expect(metrics.clientWidth, 'полоса HUD должна быть развёрнута').toBeGreaterThan(0);
    expect(
        metrics.scrollWidth,
        `полоса HUD переполнена: ${metrics.scrollWidth} > ${metrics.clientWidth}`,
    ).toBe(metrics.clientWidth);
}
