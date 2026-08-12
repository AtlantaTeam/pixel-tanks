import { test, expect, type Locator, type Page } from '@playwright/test';
import { reachFlightPhase, weaponCount } from './helpers';

/**
 * Барьер #452 — бюджеты высоты оверлеев и размеров тач-целей боевого экрана,
 * пороги из PRD `docs/game-mobile-ergonomics/prd.md` («Решение» / «Критерии
 * приёмки»): HUD ≤ 180px, палуба ≤ 150px в устоявшемся состоянии боя (без
 * подсказки жеста) / ≤ 175px до первого выстрела (с ней, issue #451),
 * свободная арена между оверлеями ≥ 55% высоты экрана на эталонном 390×844,
 * тач-цель каждой кнопки ≥ 44×44px с зазором ≥ 8px до ближайшей соседней.
 */
const HUD_MAX_HEIGHT_PX = 180;
const DECK_MAX_HEIGHT_WITH_HINT_PX = 175;
const DECK_MAX_HEIGHT_STEADY_PX = 150;
const MIN_FREE_ARENA_RATIO = 0.55;
const MIN_HIT_SIZE_PX = 44;
const MIN_HIT_GAP_PX = 8;

const VIEWPORT = { width: 390, height: 844 };

async function overlayBoxes(page: Page) {
    const hudBox = await page.getByTestId('top-hud').boundingBox();
    const deckBox = await page.getByTestId('game-hud').boundingBox();
    if (!hudBox) throw new Error('top-hud не найден');
    if (!deckBox) throw new Error('game-hud (палуба) не найден');
    return { hudBox, deckBox };
}

/** Свободная арена — видимый зазор между нижним краем HUD и верхним краем
 *  палубы (оба оверлея — `absolute`, HUD у `top-0`, палуба у `bottom-0`):
 *  считаем от фактических краёв боксов, а не `viewport.height - hud - deck`,
 *  чтобы safe-area отступы не давали ложную экономию высоты. */
function freeArenaPx(hudBox: { y: number; height: number }, deckBox: { y: number }): number {
    return deckBox.y - (hudBox.y + hudBox.height);
}

/**
 * Эффективная зона нажатия кнопки: собственный `boundingBox`, расширенный
 * псевдоэлементом `::before`, если тот используется для расширения тач-цели
 * за пределы визуального бокса (issue #450, `TrimButton`). Расширение
 * симметрично (`inset` с равными сторонами) — общий приём проекта, поэтому
 * достаточно сравнить размеры псевдо с размерами бокса и растянуть бокс
 * на разницу пополам с каждой стороны. Без класс-зависимой логики — только
 * вычисленные стили, найденные через `::before` любой кнопки.
 */
async function hitBox(
    locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    if (!box) throw new Error('кнопка не найдена');

    const pseudo = await locator.evaluate((el) => {
        const style = getComputedStyle(el, '::before');
        if (style.content === 'none' || style.position !== 'absolute') return null;
        const width = parseFloat(style.width);
        const height = parseFloat(style.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
        return { width, height };
    });

    if (!pseudo || pseudo.width <= box.width) return box;

    const expandX = (pseudo.width - box.width) / 2;
    const expandY = (pseudo.height - box.height) / 2;
    return {
        x: box.x - expandX,
        y: box.y - expandY,
        width: pseudo.width,
        height: pseudo.height,
    };
}

/** Зазор между краями двух прямоугольников (0, если пересекаются по обеим
 *  осям; для соседей в ряду — обычно чистая величина по одной оси). */
function rectGap(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
): number {
    const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
    const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
    return Math.hypot(dx, dy);
}

/** Все интерактивные кнопки контейнера — по роли `button`, не по CSS-классу:
 *  находит каждую кнопку независимо от того, как она свёрстана, и не требует
 *  правки спеки при добавлении новой кнопки в тот же контейнер. */
async function containerButtons(container: Locator): Promise<Locator[]> {
    return container.getByRole('button').all();
}

async function accessibleLabel(locator: Locator): Promise<string> {
    return (
        (await locator.getAttribute('aria-label')) ?? (await locator.textContent()) ?? '(без имени)'
    );
}

async function assertHitAreasAndGaps(container: Locator): Promise<void> {
    const buttons = await containerButtons(container);
    expect(buttons.length, 'в контейнере должна быть хотя бы одна кнопка').toBeGreaterThan(0);

    const boxes = await Promise.all(
        buttons.map(async (button) => ({
            label: await accessibleLabel(button),
            box: await hitBox(button),
        })),
    );

    for (const { label, box } of boxes) {
        expect(box.width, `«${label}» hit-area ширина`).toBeGreaterThanOrEqual(MIN_HIT_SIZE_PX);
        expect(box.height, `«${label}» hit-area высота`).toBeGreaterThanOrEqual(MIN_HIT_SIZE_PX);
    }

    for (let i = 0; i < boxes.length; i++) {
        let nearestGap = Infinity;
        for (let j = 0; j < boxes.length; j++) {
            if (i === j) continue;
            nearestGap = Math.min(nearestGap, rectGap(boxes[i].box, boxes[j].box));
        }
        if (!Number.isFinite(nearestGap)) continue; // единственная кнопка в контейнере
        expect(
            nearestGap,
            `«${boxes[i].label}» зазор до ближайшей соседней кнопки`,
        ).toBeGreaterThanOrEqual(MIN_HIT_GAP_PX);
    }
}

test.describe('Бюджет высоты оверлеев (#452) — mobile-390', () => {
    test.use({ viewport: VIEWPORT });

    test('HUD ≤180, палуба ≤175 (с подсказкой) / ≤150 (без), свободная арена ≥55%', async ({
        page,
    }) => {
        test.setTimeout(60_000);
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();
        await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);

        // До первого выстрела: подсказка жеста ещё показана (#451), палуба на
        // временном верхнем потолке ≤175 вместо устоявшихся ≤150.
        const withHint = await overlayBoxes(page);
        expect(
            withHint.hudBox.height,
            `HUD с подсказкой: ${withHint.hudBox.height}px`,
        ).toBeLessThanOrEqual(HUD_MAX_HEIGHT_PX);
        expect(
            withHint.deckBox.height,
            `палуба с подсказкой: ${withHint.deckBox.height}px`,
        ).toBeLessThanOrEqual(DECK_MAX_HEIGHT_WITH_HINT_PX);

        const freeWithHint = freeArenaPx(withHint.hudBox, withHint.deckBox);
        expect(
            freeWithHint / VIEWPORT.height,
            `свободная арена с подсказкой: ${freeWithHint}px из ${VIEWPORT.height}px`,
        ).toBeGreaterThanOrEqual(MIN_FREE_ARENA_RATIO);

        // После первого выстрела: подсказка скрыта, палуба на устоявшемся
        // потолке ≤150 — арена только шире.
        await reachFlightPhase(page);
        const steady = await overlayBoxes(page);
        expect(
            steady.hudBox.height,
            `HUD устоявшийся: ${steady.hudBox.height}px`,
        ).toBeLessThanOrEqual(HUD_MAX_HEIGHT_PX);
        expect(
            steady.deckBox.height,
            `палуба устоявшаяся: ${steady.deckBox.height}px`,
        ).toBeLessThanOrEqual(DECK_MAX_HEIGHT_STEADY_PX);

        const freeSteady = freeArenaPx(steady.hudBox, steady.deckBox);
        expect(
            freeSteady / VIEWPORT.height,
            `свободная арена устоявшаяся: ${freeSteady}px из ${VIEWPORT.height}px`,
        ).toBeGreaterThanOrEqual(MIN_FREE_ARENA_RATIO);
    });

    test('тач-цели HUD: каждая кнопка ≥44×44 с зазором ≥8px до соседней', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();
        await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);

        await assertHitAreasAndGaps(page.getByTestId('top-hud-mobile'));
    });

    test('тач-цели палубы: каждая кнопка ≥44×44 с зазором ≥8px до соседней', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();
        await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);

        await assertHitAreasAndGaps(page.getByTestId('game-deck-mobile'));
    });
});
