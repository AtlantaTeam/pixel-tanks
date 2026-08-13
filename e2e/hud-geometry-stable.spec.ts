import { test, expect, type Page } from '@playwright/test';
import {
    expectGameOverDialog,
    fireOne,
    reachBotTurn,
    reachFlightPhase,
    weaponCount,
} from './helpers';

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

            // Бюджет компактного мобильного HUD (#450): ≤180px на 390×844 в любой
            // фазе. Геометрия уже доказана неизменной выше, поэтому потолок держим
            // на всех фазах одним замером базовой. Только мобилка — на планшете
            // другой (двухрядный) состав, вне бюджета #450.
            if (viewport.width === 390) {
                for (const [phase, height] of Object.entries(heights)) {
                    expect(
                        height,
                        `top-hud высота: фаза «${phase}» = ${height}px, бюджет #450 ≤180px`,
                    ).toBeLessThanOrEqual(180);
                }
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

    // #450 — компактные кнопки ± визуально 32–36px, но тач-цель ≥44×44 с зазором
    // ≥8px до соседней. Визуальный бокс — `boundingBox` (border-box, без
    // псевдоэлемента); реальную тач-цель — размер бокса псевдоэлемента `::before`
    // (`getComputedStyle` даёт его width/height), он и есть кликабельная область
    // (браузерный hit-test через `elementFromPoint` попадает в кнопку по всей его
    // площади). Зазор между целями считаем через центры: фактическая тач-цель —
    // псевдоэлемент `before:-inset-2.5` = 52×52px (не 44px), поэтому две
    // центрированные 52px-цели разведены на ≥8px ⟺ расстояние между центрами ≥60px.
    // Полный бюджет ≥8px по всем кнопкам HUD честно меряет `overlay-budget.spec`
    // по реальному боксу псевдоэлемента — здесь дублируем его для пары ±.
    test('кнопки ± компактны (32–36px), тач-цель ≥44 с зазором ≥8px до соседней', async ({
        page,
    }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();

        const minus = page.getByRole('button', { name: 'Угол меньше' });
        const plus = page.getByRole('button', { name: 'Угол больше' });
        const minusBox = await minus.boundingBox();
        const plusBox = await plus.boundingBox();
        if (!minusBox || !plusBox) throw new Error('кнопки ± угла не найдены');

        // Визуально компактные: 32–36px по обеим осям.
        for (const box of [minusBox, plusBox]) {
            expect(box.width).toBeGreaterThanOrEqual(32);
            expect(box.width).toBeLessThanOrEqual(36);
            expect(box.height).toBeGreaterThanOrEqual(32);
            expect(box.height).toBeLessThanOrEqual(36);
        }

        // Тач-цель ≥44×44 — размер псевдоэлемента `::before` каждой кнопки.
        for (const name of ['Угол меньше', 'Угол больше']) {
            const hit = await page.evaluate((label) => {
                const btn = [...document.querySelectorAll('button')].find(
                    (b) => b.getAttribute('aria-label') === label,
                );
                if (!btn) return null;
                const bs = getComputedStyle(btn, '::before');
                return { w: parseFloat(bs.width), h: parseFloat(bs.height) };
            }, name);
            if (!hit) throw new Error(`кнопка «${name}» не найдена`);
            expect(hit.w, `«${name}» hit-area ширина`).toBeGreaterThanOrEqual(44);
            expect(hit.h, `«${name}» hit-area высота`).toBeGreaterThanOrEqual(44);
        }

        // Кнопка функциональна: клик по центру меняет угол (значение — accent-span
        // без `invisible`; зеркальный размерник ширины #447 несёт класс `invisible`).
        const angleValue = page
            .getByTestId('top-hud-mobile')
            .locator('span.text-accent:not(.invisible)')
            .first();
        const angleBefore = (await angleValue.textContent())?.trim();
        await plus.click();
        await expect
            .poll(async () => (await angleValue.textContent())?.trim())
            .not.toBe(angleBefore);

        // Зазор между 52×52 тач-целями ≥8px ⟺ центры разведены ≥60px.
        const minusCenter = minusBox.x + minusBox.width / 2;
        const plusCenter = plusBox.x + plusBox.width / 2;
        expect(
            plusCenter - minusCenter,
            `центры ± угла: ${plusCenter} − ${minusCenter} = ${plusCenter - minusCenter}px (нужно ≥60 для зазора ≥8 между 52px-целями)`,
        ).toBeGreaterThanOrEqual(60);
    });

    test('иконки mute/пауза сохраняют тач-цель ≥44×44', async ({ page }) => {
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();

        const mobile = page.getByTestId('top-hud-mobile');
        for (const name of ['Выключить звук', 'Пауза']) {
            const box = await mobile.getByRole('button', { name }).boundingBox();
            if (!box) throw new Error(`кнопка «${name}» не найдена`);
            expect(box.width, `«${name}» ширина`).toBeGreaterThanOrEqual(44);
            expect(box.height, `«${name}» высота`).toBeGreaterThanOrEqual(44);
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

// #473 — тот же вердикт «геометрия не ездит от значений», но для ДЕСКТОПНОГО
// состава панели (≥768 — иной состав, один ряд 78px на xl). #447/#449 явно вывели
// 1280/1920 из скоупа («другой состав панели, вне скоупа»); здесь достраиваем
// барьер: ширина и X каждой ячейки телеметрии, HP-карточек и пилюли хода
// неизменны при любом угле/силе/HP/ветре — 0 px. Мерим и координаты, потому что
// источник бага — каскад через `flex-1` HP-блока: смена ширины телеметрии справа
// двигала HP влево, не меняя его собственной ширины на первых семплах.
//
// #474 расширяет барьер #473 с «разных значений на своём ходу» до «между всеми
// четырьмя фазами боя» (свой ход → полёт → ход соперника → финал) — именно
// сочетание фазы и значения (не обсуждённое #473) однажды дожило до прода и было
// замечено владельцем глазами. Плюс: пилюля хода — участник геометрии наравне с
// телеметрией/HP (её текст меняется «ТВОЙ ХОД» → «ВЫСТРЕЛ» → «ХОД СОПЕРНИКА»), и
// отдельный барьер на пересечение бейджа заморозки с ячейками телеметрии —
// bounding-box, а не «на глаз по скриншоту».

type TBox = { x: number; y: number; width: number; height: number };
type TCellBox = { x: number; width: number };
type TDesktopGeometry = { telemetry: TCellBox[]; hp: TCellBox[]; turnPill: TCellBox };
type TDesktopSample = { label: string; geo: TDesktopGeometry; hudHeight: number };

function toCellBox(box: TBox): TCellBox {
    return { x: box.x, width: box.width };
}

/** Снимок геометрии десктопной панели: {x, ширина} каждой ячейки телеметрии
 *  (прямые дети ряда `top-hud-telemetry-desktop`), каждого HP-бара (прокси
 *  положения/ширины HP-карточки — трек `w-full`, двигается и тянется вместе с
 *  ней) и пилюли хода (`turn-pill`, #474 — ширина зарезервирована под самую
 *  длинную подпись, см. `TURN_PILL_SIZER` в `top-hud.tsx`). `getByRole('progressbar')`
 *  и `getByTestId` внутри десктопного блока отдают ровно один узел на дублирующую
 *  мобильную пару: мобильный дубль скрыт `md:hidden` (display:none — вне
 *  a11y-дерева и вне поиска по testid тоже, т.к. скрыт тот же родитель). */
async function desktopGeometry(page: Page): Promise<TDesktopGeometry> {
    const desktopHud = page.getByTestId('top-hud-desktop');

    const cells = page.getByTestId('top-hud-telemetry-desktop').locator(':scope > div');
    const cellCount = await cells.count();
    const telemetry: TCellBox[] = [];
    for (let i = 0; i < cellCount; i++) {
        const box = await cells.nth(i).boundingBox();
        if (!box) throw new Error(`ячейка телеметрии #${i} не найдена`);
        telemetry.push(toCellBox(box));
    }

    const bars = desktopHud.getByRole('progressbar');
    const barCount = await bars.count();
    const hp: TCellBox[] = [];
    for (let i = 0; i < barCount; i++) {
        const box = await bars.nth(i).boundingBox();
        if (!box) throw new Error(`HP-бар #${i} не найден`);
        hp.push(toCellBox(box));
    }

    const turnPillBox = await desktopHud.getByTestId('turn-pill').boundingBox();
    if (!turnPillBox) throw new Error('пилюля хода не найдена');

    return { telemetry, hp, turnPill: toCellBox(turnPillBox) };
}

async function desktopHudHeight(page: Page): Promise<number> {
    const box = await page.getByTestId('top-hud-desktop').boundingBox();
    if (!box) throw new Error('top-hud-desktop не найден');
    return box.height;
}

/**
 * Доводит один и тот же бой через все четыре фазы (свой ход → полёт → ход
 * соперника → финал), меняя угол/силу до захвата состояний вне «своего хода»,
 * и на каждом шаге снимает и геометрию, и высоту полосы. Один бой на вьюпорт —
 * тот же приём, что и `playThroughAllPhases` для мобилки/планшета выше (#449):
 * фаза и значение сочетаются в одном непрерывном прогоне, а не в отдельных
 * тестах, которые могли бы разойтись по состоянию.
 */
async function desktopPlayThroughAllPhases(page: Page): Promise<TDesktopSample[]> {
    await page.goto('/game?seed=42');
    await expect(page.getByTestId('game-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);

    const samples: TDesktopSample[] = [];
    async function sample(label: string): Promise<void> {
        samples.push({
            label,
            geo: await desktopGeometry(page),
            hudHeight: await desktopHudHeight(page),
        });
    }

    await sample('старт (угол 360°, сила 10, «ТВОЙ ХОД»)');

    // Угол через смену числа знаков (1°…3 знака) — ArrowLeft крутит ствол.
    for (let i = 0; i < 120; i++) await page.keyboard.press('ArrowLeft');
    await sample('после смены угла');

    // Сила вниз к одному знаку, затем на потолок POWER_MAX (два знака).
    for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
    await sample('сила один знак');
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowUp');
    await sample('сила на потолке POWER_MAX');

    // `reachFlightPhase` целится и стреляет — единственный выстрел за весь
    // прогон, дальше бой доигрывается автоматически.
    await reachFlightPhase(page);
    await sample('снаряд в полёте («ВЫСТРЕЛ»)');

    // Ход соперника: ветер раскрыт, телеметрия гаснет (opacity-60), появляется
    // бейдж «Заморожено» — геометрия обязана остаться прежней до пикселя.
    await expect(page.getByTestId('arena-turn-ring')).toBeVisible({ timeout: 30_000 });
    await sample('ход соперника («ХОД СОПЕРНИКА», бейдж заморозки)');

    let count = await weaponCount(page);
    while (count > 0) {
        count = await fireOne(page, () => page.keyboard.press('Space'), count, 60_000);
    }
    await expectGameOverDialog(page, 300_000);
    await sample('финал (пилюля хода скрыта invisible, HP после попаданий)');

    return samples;
}

function rectsIntersect(a: TBox, b: TBox): boolean {
    return (
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    );
}

// 1280 и 1920 — оба в критериях #473/#474 (те же цифры). Высота полосы xl — 78px.
const DESKTOP_VIEWPORTS = [
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'wide-1920', width: 1920, height: 1080 },
];

for (const viewport of DESKTOP_VIEWPORTS) {
    test.describe(`Геометрия десктопной панели неизменна от значений и фаз — ${viewport.name} (#473/#474)`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('ширина/X ячеек телеметрии, HP-карточек и пилюли хода не зависят от угла/силы/HP/ветра И от фазы боя (0 px), высота полосы — 78px во всех состояниях', async ({
            page,
        }) => {
            test.setTimeout(360_000);

            const samples = await desktopPlayThroughAllPhases(page);
            const baseline = samples[0].geo;

            for (const { label, geo, hudHeight } of samples) {
                expect(geo.telemetry.length, `${label}: число ячеек телеметрии`).toBe(
                    baseline.telemetry.length,
                );
                geo.telemetry.forEach((cell, i) => {
                    expect(Math.round(cell.x), `${label}: ячейка телеметрии #${i} X`).toBe(
                        Math.round(baseline.telemetry[i].x),
                    );
                    expect(Math.round(cell.width), `${label}: ячейка телеметрии #${i} ширина`).toBe(
                        Math.round(baseline.telemetry[i].width),
                    );
                });
                geo.hp.forEach((card, i) => {
                    expect(Math.round(card.x), `${label}: HP-карточка #${i} X`).toBe(
                        Math.round(baseline.hp[i].x),
                    );
                    expect(Math.round(card.width), `${label}: HP-карточка #${i} ширина`).toBe(
                        Math.round(baseline.hp[i].width),
                    );
                });
                expect(Math.round(geo.turnPill.x), `${label}: пилюля хода X`).toBe(
                    Math.round(baseline.turnPill.x),
                );
                expect(Math.round(geo.turnPill.width), `${label}: пилюля хода ширина`).toBe(
                    Math.round(baseline.turnPill.width),
                );

                expect(
                    Math.round(hudHeight),
                    `${label}: высота полосы top-hud-desktop = ${hudHeight}px, ожидалось 78px`,
                ).toBe(78);
            }
        });

        // Отдельный тест (критерий готовности #474): бейдж заморозки перекрывал
        // ячейки телеметрии на коротком варианте бейджа (#472) — сравнение
        // именно bounding-box'ов, а не скриншот «на глаз».
        test('бейдж заморозки не пересекает ни одну ячейку телеметрии на ходе соперника', async ({
            page,
        }) => {
            await page.goto('/game?seed=42');
            await reachBotTurn(page);

            const badge = page.getByTestId('top-hud-desktop').getByTestId('freeze-badge');
            await expect(badge).toBeVisible();
            const badgeBox = await badge.boundingBox();
            if (!badgeBox) throw new Error('бейдж заморозки не найден');

            const cells = page.getByTestId('top-hud-telemetry-desktop').locator(':scope > div');
            const cellCount = await cells.count();
            expect(cellCount, 'число ячеек телеметрии').toBeGreaterThan(0);

            for (let i = 0; i < cellCount; i++) {
                const cellBox = await cells.nth(i).boundingBox();
                if (!cellBox) throw new Error(`ячейка телеметрии #${i} не найдена`);

                expect(
                    rectsIntersect(badgeBox, cellBox),
                    `бейдж заморозки [x:${Math.round(badgeBox.x)}..${Math.round(badgeBox.x + badgeBox.width)}, y:${Math.round(badgeBox.y)}..${Math.round(badgeBox.y + badgeBox.height)}] пересекает ячейку телеметрии #${i} [x:${Math.round(cellBox.x)}..${Math.round(cellBox.x + cellBox.width)}, y:${Math.round(cellBox.y)}..${Math.round(cellBox.y + cellBox.height)}]`,
                ).toBe(false);
            }
        });

        test('полоса панели остаётся высотой 78px на xl сразу после старта (перенос элементов не возникает)', async ({
            page,
        }) => {
            await page.goto('/game?seed=42');
            await expect(page.getByTestId('top-hud-desktop')).toBeVisible();

            expect(Math.round(await desktopHudHeight(page))).toBe(78);
        });
    });
}
