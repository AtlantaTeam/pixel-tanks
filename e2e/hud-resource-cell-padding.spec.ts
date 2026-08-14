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
 */

/** Кадры, где паддинг ячеек ряда сверяется между собой. 768 — планшет: там
 *  паддинг совпадал и до правки, держим как защиту от «починили xl, уронили md».
 *  1200 — узкий xl: там ряд идёт плотным ВЕСЬ, и равенство обязано держаться
 *  и в плотном режиме. */
const PARITY_FRAMES = [768, 1200, 1280, 1440, 1920];

/** Полный пакет кадров проекта (CLAUDE.md «Адаптив») + 320 (самый узкий телефон,
 *  #537), 1200 (начало `xl` при наших брейкпоинтах) и 1440 (типовой десктоп, на
 *  котором дефект и заметили). */
const FRAMES = [320, 390, 768, 1200, 1232, 1280, 1440, 1920];

/** С этой ширины ячейкам возвращается паддинг (`min-[1280px]:px-1` в `CellShell`) —
 *  и с неё же полоса HUD обязана укладываться целиком. Ниже (1200–1279) у полосы
 *  остаётся ОТДЕЛЬНЫЙ, не связанный с паддингом дефект: левый кластер (HP + пилюля
 *  + бейджи + иконки) не ужимается и переполняет полосу на ≈7–24px даже при нулевом
 *  паддинге ячеек. Он заведён карточкой из разбора ревью #566 — сторожить его этим
 *  барьером сейчас значило бы держать красный e2e на чужом дефекте. */
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
            // Именно этот ассерт ловит вклад паддинга на узком xl: сам ряд там
            // `shrink-0`, внутренним переполнением он не рапортует ничего — зато
            // выезжает правым краем за вьюпорт (замер на 1200: 1229px правого края
            // с паддингом против 1197px без).
            expect(
                Math.ceil(metrics.right),
                `правый край ряда (${Math.ceil(metrics.right)}px) за вьюпортом ${width}px`,
            ).toBeLessThanOrEqual(width);

            const doc = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            }));
            expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
        });

        // Полоса, а не ряд: метрика ряда слепа к тому, что он выдавлен из полосы
        // целиком (ревью #566). Ниже STRIP_FITS_FROM полосу сторожит не этот
        // барьер — см. комментарий у константы.
        if (width >= STRIP_FITS_FROM) {
            test('полоса HUD укладывается в свою ширину', async ({ page }) => {
                await page.goto('/game?seed=42');
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
            });
        }
    });
}
