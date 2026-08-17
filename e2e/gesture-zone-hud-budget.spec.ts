import { test, expect, type Page } from '@playwright/test';
import { weaponCount } from './helpers';

/**
 * Барьер #538: верх зоны жеста (`GESTURE_ZONE_INSET` в `game-canvas.tsx`) —
 * захардкоженная константа, а не производная от фактической высоты `top-hud`.
 * Разойдись они — верхняя часть зоны прицеливания оказывается ПОД панелью, и
 * палец там не работает, а прежние e2e (`top-hud-viewports.spec.ts`) это не
 * ловили: они проверяют только горизонтальное переполнение и видимость HUD,
 * не совпадение вертикальных границ панели и зоны жеста.
 *
 * На планшете (768) панель занимала ~253px против объявленных зоне 128 —
 * верхние ~125px области прицеливания были под HUD.
 *
 * #557 распространил барьер на десктоп/широкий: там инсет считался от одной
 * полосы (`xl:h-[78px]`), но не от внешнего паддинга обёртки `top-hud`
 * (`p-2.5`, +20px) — фактический низ панели 98px против объявленных зоне 78.
 * Вьюпорт 1024 держит и lg-диапазон (992–1199 при наших брейкпоинтах): полоса
 * там ещё в двухрядном md-составе (~122px), а инсет уезжал на xl-значение.
 *
 * Ревью #557 добавило симметричный ассерт снизу: нижние инсеты — такая же
 * захардкоженная константа, и их расхождение с палубой не сторожило ничто.
 * Оба ассерта односторонние («не заходит за»), а не на равенство: на мобилке и
 * планшете инсеты держат запас поверх фактических высот осознанно (полосы там
 * content-sized — см. докблок `GESTURE_ZONE_INSET`), и требовать пиксель-в-пиксель
 * значило бы ломать барьер на каждом переносе строки в HUD.
 */

const VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'lg-1024', width: 1024, height: 800 },
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'wide-1920', width: 1920, height: 1080 },
];

for (const viewport of VIEWPORTS) {
    test.describe(`Верх зоны жеста не под HUD — ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('низ панели HUD не заходит за верх зоны жеста', async ({ page }) => {
            await page.goto('/game?seed=42');

            const hudBox = await page.getByTestId('top-hud').boundingBox();
            const zoneBox = await page.getByTestId('gesture-zone').boundingBox();
            expect(hudBox).not.toBeNull();
            expect(zoneBox).not.toBeNull();
            if (hudBox && zoneBox) {
                expect(
                    hudBox.y + hudBox.height,
                    `низ HUD (${hudBox.y + hudBox.height}px) должен быть не ниже верха зоны жеста (${zoneBox.y}px) — иначе верх зоны прицеливания лежит под панелью`,
                ).toBeLessThanOrEqual(zoneBox.y + 0.5);
            }
        });

        // Симметрия снизу (ревью #557): нижние инсеты зоны — такая же захардкоженная
        // константа, как верхние, и разъехаться с палубой могут ровно так же, только
        // тише — палец у нижнего края арены упирался бы в деку. Сторожить это было
        // нечем: до этой правки spec сравнивал только низ HUD с верхом зоны.
        test('низ зоны жеста не заходит за верх палубы управления', async ({ page }) => {
            await page.goto('/game?seed=42');

            const zoneBox = await page.getByTestId('gesture-zone').boundingBox();
            // Составы палубы (мобильный/планшетный/десктопный) смонтированы все —
            // берём видимый на своём брейкпоинте, как и в остальных спеках HUD.
            const deckBox = await page
                .locator('[data-testid^="game-deck"]:visible')
                .first()
                .boundingBox();
            expect(zoneBox).not.toBeNull();
            expect(deckBox, 'палуба управления должна быть видима').not.toBeNull();
            if (zoneBox && deckBox) {
                expect(
                    zoneBox.y + zoneBox.height,
                    `низ зоны жеста (${zoneBox.y + zoneBox.height}px) должен быть не ниже верха палубы (${deckBox.y}px) — иначе низ зоны прицеливания лежит под декой`,
                ).toBeLessThanOrEqual(deckBox.y + 0.5);
            }
        });
    });
}

// Критерий готовности #538: высота HUD на 768 ≤ 128px (объявленный инсет
// `md:top-[128px]`), явным числом — не только относительным сравнением с
// зоной жеста выше.
test.describe('Высота HUD на планшете (768) в бюджете', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('высота top-hud не превышает 128px', async ({ page }) => {
        await page.goto('/game?seed=42');

        const hudBox = await page.getByTestId('top-hud').boundingBox();
        expect(hudBox).not.toBeNull();
        if (hudBox) {
            expect(hudBox.height).toBeLessThanOrEqual(128);
        }
    });
});

/**
 * Барьер связи `AimHint` ↔ зоны жеста (ревью #574, nit): верхний инсет подсказки
 * (`top-[252px] md:top-[138px] xl:top-[108px]` в `aim-hint.tsx`) держится за верхом
 * `GESTURE_ZONE_INSET` только соглашением «+10px под верх зоны» — комментарий у
 * зоны это правило описывает, но детерминированного барьера на +10px не было: при
 * смене высот HUD подсказка тихо разъехалась бы с зоной. Здесь соглашение —
 * проверяемый инвариант: верх подсказки на 10px ниже верха зоны на каждом
 * брейкпоинте. Подсказка показывается разово на свежей сессии (флаг `aim-hint`
 * ещё не выставлен), поэтому грузим страницу без взаимодействия.
 */
const AIM_HINT_ZONE_GAP = 10;
/** Тот же пакет кадров, что у `VIEWPORTS` выше (ревью #557): классы подсказки и зоны
 *  на 1920 те же, что на 1280 (`xl:`), но держать в одном файле два разных набора
 *  кадров — способ снова получить брейкпоинт наполовину под барьером. */
const HINT_VIEWPORTS = VIEWPORTS;

for (const viewport of HINT_VIEWPORTS) {
    test.describe(`Подсказка прицеливания привязана к зоне жеста — ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('верх AimHint на +10px ниже верха зоны жеста', async ({ page }) => {
            await page.goto('/game?seed=42');

            const hintBox = await page.getByTestId('aim-hint').boundingBox();
            const zoneBox = await page.getByTestId('gesture-zone').boundingBox();
            expect(hintBox, 'разовая подсказка должна быть видна на свежей сессии').not.toBeNull();
            expect(zoneBox).not.toBeNull();
            if (hintBox && zoneBox) {
                const gap = hintBox.y - zoneBox.y;
                expect(
                    Math.abs(gap - AIM_HINT_ZONE_GAP),
                    `верх подсказки (${hintBox.y}px) должен быть на ~${AIM_HINT_ZONE_GAP}px ниже верха зоны (${zoneBox.y}px), а разошёлся на ${gap}px — подсказка отвязалась от зоны`,
                ).toBeLessThanOrEqual(1.5);
            }
        });
    });
}

/** Эмулирует держащийся тач-жест «оттяни» (pointerdown → pointermove, БЕЗ
 *  pointerup — превью остаётся на экране), как `holdDragGesture` в
 *  `aim-preview-viewports.spec.ts`, но со стартовой точкой в АБСОЛЮТНЫХ
 *  координатах страницы (а не в долях от канваса) — нужно, чтобы прицельно
 *  стартовать оттяжку в конкретной строке пикселей верхней части арены. */
/**
 * Оттяжка синтетическими pointer-событиями на канвасе.
 *
 * ВАЖНО, чего эта функция НЕ проверяет: `dispatchEvent` доставляет событие адресату
 * напрямую, минуя браузерный hit-testing — накрой панель HUD эту точку, событие всё
 * равно придёт на канвас. Поэтому перекрытие проверяется ОТДЕЛЬНО, ассертом
 * `expectPointHitsCanvas` ниже, и без него тест не доказывает своего заголовка.
 *
 * Реальный `page.mouse` здесь не годится: движок принимает жест-рогатку только от
 * touch/pen, мышь идёт своей схемой (движение — угол, клик — выстрел), см.
 * `game-canvas.tsx`. А `page.touchscreen` умеет только `tap` — оттяжки в API нет.
 */
async function holdDragAt(
    page: Page,
    start: { x: number; y: number },
    end: { x: number; y: number },
): Promise<void> {
    await page.evaluate(
        ({ start, end }) => {
            const canvas = document.querySelector<HTMLCanvasElement>('canvas.game-canvas');
            if (!canvas) throw new Error('canvas не найден');
            const base: PointerEventInit = {
                pointerId: 1,
                pointerType: 'touch',
                isPrimary: true,
                bubbles: true,
                cancelable: true,
            };
            canvas.dispatchEvent(
                new PointerEvent('pointerdown', { ...base, clientX: start.x, clientY: start.y }),
            );
            canvas.dispatchEvent(
                new PointerEvent('pointermove', { ...base, clientX: end.x, clientY: end.y }),
            );
        },
        { start, end },
    );
}

/**
 * Палец в этой точке попадёт В КАНВАС, а не в панель — по настоящему hit-testing'у
 * браузера (`elementFromPoint`), с учётом абсолютных детей HUD, вылезающих за бокс
 * родителя. Это и есть критерий #538, который синтетический жест проверить не может.
 */
async function expectPointHitsCanvas(page: Page, point: { x: number; y: number }): Promise<void> {
    const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'ничего';
        const cls = el.getAttribute('class') ?? '';
        return `${el.tagName}${cls ? `.${cls.split(' ').slice(0, 2).join('.')}` : ''}`;
    }, point);
    expect(hit, `точка (${point.x}, ${point.y}) обязана попадать в канвас, а не в HUD`).toContain(
        'CANVAS',
    );
}

// Критерий готовности #538: тап в верхней части арены на 768 доходит до
// жеста, а не в панель. До фикса эта строка пикселей (чуть ниже объявленного
// инсета зоны 128px) лежала под фактической ~253px панелью — pointerdown
// глотался бы HUD-оверлеем/его дочерними элементами до канваса, а не
// начинал прицеливание. Сигнал «жест начался» — оверлей жеста (луч+кольцо,
// testid `gesture-overlay`; тот же приём, что `aim-preview-viewports.spec.ts`):
// он появляется, только если движок принял pointerdown и активировал режим
// прицеливания. Чип с текстом «ОТПУСТИ — ВЫСТРЕЛ» удалён (#565).
test.describe('Оттяжка у верха арены на планшете (768) начинает прицеливание', () => {
    test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

    test('точка сразу под зоной жеста запускает жест-рогатку', async ({ page }) => {
        test.setTimeout(60_000);
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();
        await expect.poll(() => weaponCount(page)).toBe(5);
        // Движок гасит pointerdown, пока не вышел из стартового fire-режима в
        // idle (та же причина, что в `reachPlayerAim` — `aim-preview-viewports.spec.ts`).
        // Ждём по сигналу движка, а не по таймеру.
        await expect(page.getByTestId('game-canvas')).toHaveAttribute('data-engine-mode', 'idle');

        const zoneBox = await page.getByTestId('gesture-zone').boundingBox();
        expect(zoneBox).not.toBeNull();
        if (!zoneBox) return;

        const startX = zoneBox.x + zoneBox.width / 2;
        const startY = zoneBox.y + 10;
        // Сначала — что палец сюда вообще доходит (панель не перекрывает), потом — что
        // движок принял жест. Порознь ни то, ни другое критерия #538 не доказывает.
        await expectPointHitsCanvas(page, { x: startX, y: startY });
        await holdDragAt(page, { x: startX, y: startY }, { x: startX - 60, y: startY + 60 });

        await expect(page.getByTestId('gesture-overlay')).toBeVisible();
    });
});
