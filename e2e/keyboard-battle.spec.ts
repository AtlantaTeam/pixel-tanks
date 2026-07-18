import { test, expect, type Page } from '@playwright/test';

// Полный бой одной клавиатурой: стрелки настраивают угол/мощность, Enter/Space
// стреляют — без единого клика мыши бой с ботом идёт от старта до конца. Плюс
// проверка, что три схемы (клавиатура / мышь / тач-жест) не конфликтуют на одном
// canvas: каждый ход любой из них тратит ровно одно оружие, без двойных выстрелов.
//
// Seed фиксирован — физика детерминирована (см. .claude/rules/canvas.md).
const SEED = 42;

const PLAYER_WEAPONS = 5; // WEAPONS_AMOUNT=10, поровну между танками
const PIXELS_PER_POWER_UNIT = 8; // DRAG_AIM_DEFAULTS.pixelsPerPowerUnit

/** Сколько снарядов осталось у игрока — по числу опций в селекте оружия HUD. */
async function weaponCount(page: Page): Promise<number> {
    return page.locator('#weapon-select option').count();
}

/**
 * Повторяет `action` (нажатие клавиши / клик / тач-жест), пока у игрока не станет
 * ровно на одно оружие меньше. Каждая из трёх схем — no-op вне активного хода
 * игрока (движок гасит выстрел, пока снаряд в полёте или ход бота), поэтому
 * ровно один выстрел на ход, без двойных. Возвращает новое число оружия.
 */
async function fireOne(page: Page, action: () => Promise<void>, before: number): Promise<number> {
    for (let attempt = 0; attempt < 200; attempt++) {
        await action();
        await page.waitForTimeout(150);
        const count = await weaponCount(page);
        if (count < before) return count;
    }
    throw new Error('выстрел не прошёл за отведённое число попыток');
}

/**
 * Эмулирует тач-жест «оттяни и отпусти» на Canvas: pointerdown → pointermove →
 * pointerup c pointerType 'touch'. Оттяжка рисуется противоположно вектору
 * выстрела (рогатка), её длина задаёт мощность.
 */
async function dispatchDragGesture(page: Page): Promise<void> {
    await page.evaluate((pixelsPerPowerUnit) => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas.game-canvas');
        if (!canvas) throw new Error('canvas не найден');
        const rect = canvas.getBoundingClientRect();
        const startX = rect.left + rect.width * 0.4;
        const startY = rect.top + rect.height * 0.5;
        // Выстрел вверх-вправо к врагу: угол −45°, мощность 6.
        const angle = -Math.PI / 4;
        const dragLength = 6 * pixelsPerPowerUnit;
        const endX = startX - Math.cos(angle) * dragLength;
        const endY = startY - Math.sin(angle) * dragLength;
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
        canvas.dispatchEvent(
            new PointerEvent('pointerup', { ...base, clientX: endX, clientY: endY }),
        );
    }, PIXELS_PER_POWER_UNIT);
}

/** Клик мыши по canvas вверх-справа от левого танка — лоб в сторону врага. */
async function clickCanvas(page: Page): Promise<void> {
    const box = await page.locator('canvas.game-canvas').boundingBox();
    if (!box) throw new Error('boundingBox canvas недоступен');
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
}

async function startGame(page: Page): Promise<void> {
    await page.goto(`/game?seed=${SEED}`);
    await expect(page.getByTestId('game-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBe(PLAYER_WEAPONS);
}

async function expectGameOverDialog(page: Page): Promise<void> {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText(/Победа!|Поражение|Ничья/);
    await expect(dialog).toContainText('Счёт:');
}

test.describe('бой только клавиатурой', () => {
    test('полный бой стрелками и Space/Enter без мыши', async ({ page }) => {
        test.setTimeout(120_000);

        await startGame(page);

        // Прицел настраиваем только клавиатурой: стрелка влево поднимает ствол
        // (угол в canvas-осях к −45°), лоб летит вправо к врагу.
        for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowLeft');
        // Мощность тоже с клавиатуры (стрелка вверх), проверяя точную настройку.
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');

        // Чередуем Space и Enter — обе клавиши стреляют (issue #13).
        let count = PLAYER_WEAPONS;
        let shot = 0;
        while (count > 0) {
            const key = shot % 2 === 0 ? 'Space' : 'Enter';
            count = await fireOne(page, () => page.keyboard.press(key), count);
            shot++;
        }

        await expectGameOverDialog(page);

        await page.screenshot({ path: 'screenshots/keyboard-battle.png', fullPage: false });
    });

    test('три схемы (клавиатура/мышь/тач) не конфликтуют на одном canvas', async ({ page }) => {
        test.setTimeout(120_000);

        await startGame(page);

        // Каждый ход — своя схема; ждём ровно −1 оружия, без двойных выстрелов.
        // Порядок «тач → мышь» проверяет, что подавление синтетического клика после
        // жеста не блокирует последующий честный клик мыши (suppressClickRef сброс).
        let count = PLAYER_WEAPONS;
        count = await fireOne(page, () => page.keyboard.press('Space'), count);
        expect(count).toBe(4);

        count = await fireOne(page, () => clickCanvas(page), count);
        expect(count).toBe(3);

        count = await fireOne(page, () => dispatchDragGesture(page), count);
        expect(count).toBe(2);

        count = await fireOne(page, () => clickCanvas(page), count);
        expect(count).toBe(1);

        count = await fireOne(page, () => page.keyboard.press('Enter'), count);
        expect(count).toBe(0);

        await expectGameOverDialog(page);
    });
});
