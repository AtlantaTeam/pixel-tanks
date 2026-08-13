import { test, expect, type Page } from '@playwright/test';
import { weaponCount } from './helpers';

// Предпросмотр траектории при жесте-рогатке (issue #475): во время оттяжки на арене
// видны дуга предпросмотра (canvas), индикатор «угол·сила» у ствола (canvas) и луч
// натяжения с чипом (DOM-оверлей). Проверяем на канонических вьюпортах проекта
// (CLAUDE.md «Адаптив»), удерживая жест (pointerdown+move без pointerup), чтобы
// превью оставалось на экране в момент скриншота. Seed фиксируем — рельеф и ветер
// детерминированы (.claude/rules/canvas.md), скриншот воспроизводим.
const SEED = 42;

const VIEWPORTS = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
];

// Вектор выстрела: вверх-вправо к врагу (−45°), средняя сила — дуга хорошо видна.
const SHOT = { startXRatio: 0.5, startYRatio: 0.5, angle: -0.785, power: 10 };
const PIXELS_PER_POWER_UNIT = 8; // DRAG_AIM_DEFAULTS.pixelsPerPowerUnit

/**
 * Удерживает тач-жест «оттяни» на Canvas: pointerdown → pointermove БЕЗ pointerup,
 * чтобы предпросмотр остался на экране. Вектор оттяжки противоположен выстрелу
 * (рогатка), длина оттяжки задаёт мощность (как в `touch-battle.spec.ts`).
 */
async function holdDragGesture(page: Page, shot: typeof SHOT): Promise<void> {
    await page.evaluate(
        ({ shot, pixelsPerPowerUnit }) => {
            const canvas = document.querySelector<HTMLCanvasElement>('canvas.game-canvas');
            if (!canvas) throw new Error('canvas не найден');
            const rect = canvas.getBoundingClientRect();
            const startX = rect.left + rect.width * shot.startXRatio;
            const startY = rect.top + rect.height * shot.startYRatio;
            const dragLength = shot.power * pixelsPerPowerUnit;
            const endX = startX - Math.cos(shot.angle) * dragLength;
            const endY = startY - Math.sin(shot.angle) * dragLength;
            const base: PointerEventInit = {
                pointerId: 1,
                pointerType: 'touch',
                isPrimary: true,
                bubbles: true,
                cancelable: true,
            };
            canvas.dispatchEvent(
                new PointerEvent('pointerdown', { ...base, clientX: startX, clientY: startY }),
            );
            canvas.dispatchEvent(
                new PointerEvent('pointermove', { ...base, clientX: endX, clientY: endY }),
            );
        },
        { shot, pixelsPerPowerUnit: PIXELS_PER_POWER_UNIT },
    );
}

/** Ждёт ход игрока (боезапас роздан, движок вышел из стартового fire в idle-аим). */
async function reachPlayerAim(page: Page): Promise<void> {
    await expect(page.getByTestId('game-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBe(5);
    // Движок гасит pointerdown, пока не вышел из стартового fire-режима в idle —
    // короткая пауза даёт первым кадрам rAF перевести ход в аим.
    await page.waitForTimeout(400);
}

for (const viewport of VIEWPORTS) {
    test.describe(`Предпросмотр траектории — ${viewport.name}`, () => {
        test.use({
            viewport: { width: viewport.width, height: viewport.height },
            hasTouch: true,
            isMobile: true,
        });

        test('дуга, индикатор у ствола и луч натяжения видны, без переполнения', async ({
            page,
        }) => {
            test.setTimeout(60_000);
            await page.goto(`/game?seed=${SEED}`);
            await reachPlayerAim(page);

            await holdDragGesture(page, SHOT);
            // Чип оверлея — прокси того, что жест-рогатка активна и превью на экране.
            await expect(page.getByText('ОТПУСТИ — ВЫСТРЕЛ')).toBeVisible();
            // Кадр движка успевает отрисовать дугу и индикатор у ствола на канвасе.
            await page.waitForTimeout(200);

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
            expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

            await page.screenshot({
                path: `screenshots/aim-preview-${viewport.name}.png`,
                fullPage: false,
            });
        });
    });
}

test.describe('Предпросмотр траектории — prefers-reduced-motion (статичный пунктир)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('дуга рисуется и при reduced-motion (без бегущего пунктира)', async ({ page }) => {
        test.setTimeout(60_000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`/game?seed=${SEED}`);
        await reachPlayerAim(page);

        await holdDragGesture(page, SHOT);
        await expect(page.getByText('ОТПУСТИ — ВЫСТРЕЛ')).toBeVisible();
        await page.waitForTimeout(200);

        await page.screenshot({
            path: `screenshots/aim-preview-reduced-motion.png`,
            fullPage: false,
        });
    });
});
