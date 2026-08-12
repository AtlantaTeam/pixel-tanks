import { test, expect, type Page } from '@playwright/test';
import { expectGameOverDialog, fireOne, reachFlightPhase, weaponCount } from './helpers';

/**
 * #447/#449 — геометрия верхнего HUD не зависит ни от фазы боя, ни от значений.
 * Барьер вмораживает вердикт: высота панели совпадает во ВСЕХ четырёх состояниях
 * боя (свой ход, снаряд в полёте, ход соперника, финал), а координаты кнопок ±
 * и ширина ячеек/HP-карточек не ездят при смене значений (в т.ч. после
 * попадания).
 *
 * #449 меняет способ доказательства: #447 сверял только «свой ход vs ход бота»
 * и обосновывал остальные два состояния (полёт, финал) рассуждением о
 * подмножестве изменений. Рассуждение — не барьер: оно не ловит регрессию,
 * которая случайно попадёт именно в необсуждённую комбинацию (напр. правка,
 * растящая высоту `deck-lock`-подобной заметки только во время полёта). #449
 * измеряет все четыре состояния явно, одним непрерывным боем на вьюпорт —
 * не четыре отдельных прогона, а один: `свой ход` (старт) → выстрел → `снаряд в
 * полёте` (лочит `deck-lock` с причиной `flight`) → `ход соперника`
 * (`arena-turn-ring`) → доигрывание до `финала` (`expectGameOverDialog`).
 */

async function topHudHeight(page: Page): Promise<number> {
    const box = await page.getByTestId('top-hud').boundingBox();
    if (!box) throw new Error('top-hud не найден');
    return box.height;
}

/** Ширина HP-бара соперника (второй `progressbar` в HUD — см. порядок в
 *  `top-hud.tsx`: игрок рендерится первым). `getByRole` сам отфильтровывает
 *  скрытый CSS-вариантом (мобилка/десктоп) дубль — виден ровно один. */
async function enemyHpBarWidth(page: Page): Promise<number> {
    const box = await page.getByRole('progressbar').nth(1).boundingBox();
    if (!box) throw new Error('HP-бар соперника не найден');
    return box.width;
}

// Высоту и ширину HP-карточки сверяем на моб (390) и планшете (768) — оба в
// критериях #447/#449. Десктоп (1280/1920) — другой состав панели, вне скоупа.
const HEIGHT_VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
];

/**
 * Доводит один и тот же бой (seed=42, прицел −45°/чуть силы — тот же, что и в
 * `battle-states-viewports.spec.ts`) через все четыре состояния, замеряя высоту
 * `top-hud` и ширину HP-бара соперника в каждом. Один бой на вьюпорт вместо
 * четырёх — снаряд в полёте и ход соперника — это ОДНО и то же продолжение боя,
 * а не отдельные сценарии.
 */
async function playThroughAllPhases(
    page: Page,
): Promise<{ heights: Record<string, number>; hpWidths: Record<string, number> }> {
    await page.goto('/game?seed=42');
    await expect(page.getByTestId('top-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);

    const heights: Record<string, number> = {};
    const hpWidths: Record<string, number> = {};

    heights['свой ход'] = await topHudHeight(page);
    hpWidths['свой ход'] = await enemyHpBarWidth(page);

    // `reachFlightPhase` сама целится (−45°/чуть силы) и стреляет — единственный
    // выстрел за весь прогон, дальше бой доигрывается автоматически.
    await reachFlightPhase(page);
    heights['снаряд в полёте'] = await topHudHeight(page);

    await expect(page.getByTestId('arena-turn-ring')).toBeVisible({ timeout: 30_000 });
    heights['ход соперника'] = await topHudHeight(page);

    let count = await weaponCount(page);
    while (count > 0) {
        count = await fireOne(page, () => page.keyboard.press('Space'), count, 60_000);
    }
    await expectGameOverDialog(page, 300_000);
    heights['финал'] = await topHudHeight(page);
    hpWidths['финал'] = await enemyHpBarWidth(page);

    return { heights, hpWidths };
}

for (const viewport of HEIGHT_VIEWPORTS) {
    test.describe(`Геометрия HUD стабильна во всех фазах — ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('высота top-hud совпадает на «свой ход» / «снаряд в полёте» / «ход соперника» / «финал» (0 px)', async ({
            page,
        }) => {
            test.setTimeout(360_000);

            const { heights } = await playThroughAllPhases(page);
            const baselinePhase = 'свой ход';
            const baseline = heights[baselinePhase];

            for (const [phase, height] of Object.entries(heights)) {
                expect(
                    height,
                    `top-hud высота: фаза «${phase}» = ${height}px, ожидалось как на «${baselinePhase}» = ${baseline}px (разница ${Math.abs(height - baseline)}px)`,
                ).toBe(baseline);
            }
        });

        test('ширина HP-бара соперника не меняется после попадания (0 px)', async ({ page }) => {
            test.setTimeout(360_000);

            const { hpWidths } = await playThroughAllPhases(page);
            const before = hpWidths['свой ход'];
            const after = hpWidths['финал'];

            expect(
                Math.round(after),
                `HP-бар соперника: до боя (100/100) = ${before}px, после попадания (финал) = ${after}px (разница ${Math.abs(after - before)}px)`,
            ).toBe(Math.round(before));
        });
    });
}

// Ширину телеметрии и координаты кнопок ± проверяем на мобилке (390): именно там
// живут тач-кнопки ± и колонка из рядов (планшет/десктоп — панель без ±).
test.describe('Ширина ячеек и координаты кнопок ± неизменны — mobile-390', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('кнопка «+» угла не ездит при смене числа знаков значения', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();

        const plusButton = page.getByRole('button', { name: 'Угол больше' });
        await expect(plusButton).toBeVisible();

        async function plusButtonX(): Promise<number> {
            const box = await plusButton.boundingBox();
            if (!box) throw new Error('кнопка «+» угла не найдена');
            return box.x;
        }

        // Прогоняем угол через 1 → 2 → 3 знака нажатиями ArrowLeft: координата
        // левого края кнопки «+» обязана остаться неизменной (значение центрируется
        // в зарезервированном под «360°» боксе). Старт (0 нажатий) — уже «360°»
        // (formatAngle(0) === 360), т.е. потолок диапазона проверяется тем же
        // семплом, без отдельного сценария.
        const samples: Array<{ label: string; x: number }> = [];
        samples.push({ label: '0 нажатий (360°)', x: await plusButtonX() });
        for (const presses of [5, 45, 120]) {
            for (let i = 0; i < presses; i++) await page.keyboard.press('ArrowLeft');
            samples.push({ label: `после ${presses} нажатий подряд`, x: await plusButtonX() });
        }

        const baseline = samples[0];
        for (const sample of samples) {
            expect(
                sample.x,
                `кнопка «+» угла: X «${sample.label}» = ${sample.x}px, ожидалось как на «${baseline.label}» = ${baseline.x}px (разница ${Math.abs(sample.x - baseline.x)}px)`,
            ).toBe(baseline.x);
        }
    });

    test('кнопка «+» силы не ездит при спуске к одному знаку и выходе на потолок POWER_MAX', async ({
        page,
    }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();

        const plusButton = page.getByRole('button', { name: 'Сила больше' });
        await expect(plusButton).toBeVisible();

        async function plusButtonX(): Promise<number> {
            const box = await plusButton.boundingBox();
            if (!box) throw new Error('кнопка «+» силы не найдена');
            return box.x;
        }

        // Старт (сила=10, два знака) → вниз к одному знаку (1) → вверх за потолок
        // (POWER_MAX=20, зажимается движком) — координата кнопки «+» не должна
        // сместиться ни на одном шаге.
        const samples: Array<{ label: string; x: number }> = [];
        samples.push({ label: 'старт (10)', x: await plusButtonX() });

        for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
        samples.push({ label: 'один знак (1)', x: await plusButtonX() });

        for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowUp');
        samples.push({ label: 'потолок (POWER_MAX)', x: await plusButtonX() });

        const baseline = samples[0];
        for (const sample of samples) {
            expect(
                sample.x,
                `кнопка «+» силы: X «${sample.label}» = ${sample.x}px, ожидалось как на «${baseline.label}» = ${baseline.x}px (разница ${Math.abs(sample.x - baseline.x)}px)`,
            ).toBe(baseline.x);
        }
    });

    test('обе HP-карточки одинаковой ширины и не зависят от значения', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('top-hud')).toBeVisible();

        // HP-карточки — flex-1: делят ряд поровну, ширина не зависит от числа HP.
        const cards = page.getByTestId('top-hud-mobile').getByRole('progressbar');
        const playerBar = cards.first();
        const enemyBar = cards.nth(1);

        const playerBox = await playerBar.boundingBox();
        const enemyBox = await enemyBar.boundingBox();
        expect(playerBox).not.toBeNull();
        expect(enemyBox).not.toBeNull();
        if (playerBox && enemyBox) {
            expect(
                Math.round(enemyBox.width),
                `HP-бар соперника ${enemyBox.width}px vs игрока ${playerBox.width}px`,
            ).toBe(Math.round(playerBox.width));
        }
    });
});
