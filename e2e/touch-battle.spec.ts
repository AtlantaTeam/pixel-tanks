import { test, expect, type Page } from '@playwright/test';

// Полный бой пальцем на телефоне: жест «оттяни и отпусти» (слингшот) ведёт бой
// с ботом от старта до конца на 375px в портрете и ландшафте (touch-эмуляция).
//
// Seed фиксируем — физика детерминирована (см. .claude/rules/canvas.md), значит
// исход боя воспроизводим от прогона к прогону при одинаковых жестах.
const SEED = 42;

type TShot = {
    // Точка старта жеста в долях от размеров canvas (0..1).
    startXRatio: number;
    startYRatio: number;
    // Вектор выстрела: угол в радианах (canvas-оси, вверх — отрицательный)
    // и мощность (1..20). Оттяжка рисуется противоположно вектору (рогатка).
    angle: number;
    power: number;
};

const VIEWPORTS: { name: string; width: number; height: number; shot: TShot }[] = [
    {
        name: 'portrait-375x667',
        width: 375,
        height: 667,
        // Дальность полёта ≈ power²·10 px; на 375px до врага ~half width (~187px),
        // потому мощность мала — иначе снаряд улетает за стены и рикошетит в свой танк.
        shot: { startXRatio: 0.6, startYRatio: 0.4, angle: -0.785, power: 4 },
    },
    {
        name: 'landscape-667x375',
        width: 667,
        height: 375,
        // Поле шире (667px) — до врага ~333px, нужна бо́льшая мощность.
        shot: { startXRatio: 0.6, startYRatio: 0.4, angle: -0.785, power: 6 },
    },
];

const PIXELS_PER_POWER_UNIT = 8; // DRAG_AIM_DEFAULTS.pixelsPerPowerUnit

/**
 * Эмулирует тач-жест «оттяни и отпусти» на Canvas: pointerdown → pointermove →
 * pointerup c pointerType 'touch'. Вектор оттяжки противоположен вектору
 * выстрела (рогатка), длина оттяжки задаёт мощность.
 */
async function dispatchDragGesture(page: Page, shot: TShot): Promise<void> {
    await page.evaluate(
        ({ shot, pixelsPerPowerUnit }) => {
            const canvas = document.querySelector<HTMLCanvasElement>('canvas.game-canvas');
            if (!canvas) throw new Error('canvas не найден');
            const rect = canvas.getBoundingClientRect();
            const startX = rect.left + rect.width * shot.startXRatio;
            const startY = rect.top + rect.height * shot.startYRatio;
            // Вектор выстрела в пикселях; оттяжка — в противоположную сторону.
            const dragLength = shot.power * pixelsPerPowerUnit;
            const shotDx = Math.cos(shot.angle) * dragLength;
            const shotDy = Math.sin(shot.angle) * dragLength;
            const endX = startX - shotDx;
            const endY = startY - shotDy;

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
        },
        { shot, pixelsPerPowerUnit: PIXELS_PER_POWER_UNIT },
    );
}

/** Сколько снарядов осталось у игрока — по числу опций в селекте оружия HUD. */
async function weaponCount(page: Page): Promise<number> {
    return page.locator('#weapon-select option').count();
}

/**
 * Ведёт бой до конца: пока у игрока есть оружие, повторяет жест. Жест —
 * no-op, если сейчас не ход игрока (движок гасит pointerdown вне активного
 * хода), поэтому ровно один выстрел на ход игрока, без двойных выстрелов.
 */
async function playBattle(page: Page, shot: TShot): Promise<void> {
    let safety = 0;
    while (safety++ < 300) {
        const count = await weaponCount(page);
        if (count === 0) return;
        await dispatchDragGesture(page, shot);
        // Даём снаряду игрока и ответу бота отыграться до следующего хода.
        await page.waitForTimeout(300);
    }
    throw new Error('бой не завершился за отведённое число попыток');
}

for (const viewport of VIEWPORTS) {
    test.describe(`тач-бой ${viewport.name}`, () => {
        test.use({
            viewport: { width: viewport.width, height: viewport.height },
            hasTouch: true,
            isMobile: true,
        });

        test(`полный бой жестом от старта до конца`, async ({ page }) => {
            test.setTimeout(120_000);

            await page.goto(`/game?seed=${SEED}`);

            // Ждём, пока игра инициализируется: HUD виден, оружие роздано.
            await expect(page.getByTestId('game-hud')).toBeVisible();
            await expect.poll(() => weaponCount(page)).toBe(5);

            await playBattle(page, viewport.shot);

            // Бой отыгран целиком жестом — появился экран результата с решённым
            // исходом и счётом. Конкретного победителя не проверяем: исход зависит
            // от хаотичной динамики «прицел vs бот» (снаряд рикошетит от стен
            // короткого канваса), а тест верифицирует играбельность тачем от старта
            // до конца, а не силу бота — иначе он был бы хрупким к правкам физики.
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible({ timeout: 30_000 });
            await expect(dialog).toContainText(/Победа!|Поражение|Ничья/);
            await expect(dialog).toContainText('Счёт:');

            await page.screenshot({
                path: `screenshots/touch-battle-${viewport.name}.png`,
                fullPage: false,
            });
        });
    });
}
