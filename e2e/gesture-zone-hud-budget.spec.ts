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
 * Вьюпорты — мобилка (390) и планшет (768), как `HEIGHT_VIEWPORTS` в
 * `hud-geometry-stable.spec.ts`: десктоп/широкий (1280/1920) — другой,
 * заведомо не резиновый состав панели (`xl:h-[78px]`) с отдельным, уже
 * существовавшим ДО этого фикса расхождением высоты панели (78px) и внешнего
 * паддинга `top-hud` (`p-2.5`, ещё +20px) против `lg:top-[78px]` зоны жеста —
 * вне скоупа #538 (заведено отдельной карточкой, #538 — только про 768).
 */

const VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
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

/** Эмулирует держащийся тач-жест «оттяни» (pointerdown → pointermove, БЕЗ
 *  pointerup — превью остаётся на экране), как `holdDragGesture` в
 *  `aim-preview-viewports.spec.ts`, но со стартовой точкой в АБСОЛЮТНЫХ
 *  координатах страницы (а не в долях от канваса) — нужно, чтобы прицельно
 *  стартовать оттяжку в конкретной строке пикселей верхней части арены. */
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

// Критерий готовности #538: тап в верхней части арены на 768 доходит до
// жеста, а не в панель. До фикса эта строка пикселей (чуть ниже объявленного
// инсета зоны 128px) лежала под фактической ~253px панелью — pointerdown
// глотался бы HUD-оверлеем/его дочерними элементами до канваса, а не
// начинал прицеливание. Сигнал «жест начался» — чип «ОТПУСТИ — ВЫСТРЕЛ»
// (тот же приём, что `aim-preview-viewports.spec.ts`): он появляется, только
// если движок принял pointerdown и активировал режим прицеливания.
test.describe('Оттяжка у верха арены на планшете (768) начинает прицеливание', () => {
    test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

    test('точка сразу под зоной жеста запускает жест-рогатку', async ({ page }) => {
        test.setTimeout(60_000);
        await page.goto('/game?seed=42');
        await expect(page.getByTestId('game-hud')).toBeVisible();
        await expect.poll(() => weaponCount(page)).toBe(5);
        // Движок гасит pointerdown, пока не вышел из стартового fire-режима в
        // idle (та же причина, что в `reachPlayerAim` — `aim-preview-viewports.spec.ts`).
        await page.waitForTimeout(400);

        const zoneBox = await page.getByTestId('gesture-zone').boundingBox();
        expect(zoneBox).not.toBeNull();
        if (!zoneBox) return;

        const startX = zoneBox.x + zoneBox.width / 2;
        const startY = zoneBox.y + 10;
        await holdDragAt(page, { x: startX, y: startY }, { x: startX - 60, y: startY + 60 });

        await expect(page.getByText('ОТПУСТИ — ВЫСТРЕЛ')).toBeVisible();
    });
});
