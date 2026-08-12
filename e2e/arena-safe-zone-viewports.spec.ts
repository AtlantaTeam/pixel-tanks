import { test, expect, type Page } from '@playwright/test';
import { weaponCount } from './helpers';

/**
 * Барьер #456 — обе гарантии фазы 3 («Safe-зона арены и масштаб мира»,
 * #453–#455), которые раньше проверялись только глазами по скриншотам:
 *
 * - танки целиком внутри свободной зоны арены — ни один пиксель корпуса не
 *   под верхним HUD (`top-hud`) и не под палубой (`game-hud`, issue #454);
 * - ширина танка пропорциональна ширине арены (масштаб мира, issue #455):
 *   ≤10% на 390, ≥4% на 1280 (границы — из докблока `world-scale.ts`
 *   `WORLD_SCALE_MIN`/`MAX`, не гадание).
 *
 * Свободную зону меряем по факту отрисованных оверлеев (`boundingBox` HUD и
 * палубы в page-координатах, как `overlay-budget.spec.ts`), а не по
 * внутреннему `GamePlay.arenaZone` — так барьер ловит и рассинхрон между
 * реальной вёрсткой оверлеев и инсетами, которые движок думает, что читает.
 * Положение и размер корпуса — через read-only `window.__gameDebug`
 * (`game-debug.ts`): у канваса нет DOM-узла на танк для `boundingBox()`.
 *
 * Фиксированный сид (42, как в остальных боевых e2e) — детерминированный
 * рельеф и стартовые позиции танков (¼ / ¾ ширины арены, `game-play.ts`).
 */

const SEED = 42;

type TArenaSafeZoneViewport = {
    name: string;
    width: number;
    height: number;
    /** Верхняя граница доли ширины танка от ширины арены (`world-scale.ts`). */
    maxWidthRatio?: number;
    /** Нижняя граница доли ширины танка от ширины арены (`world-scale.ts`). */
    minWidthRatio?: number;
};

const VIEWPORTS: TArenaSafeZoneViewport[] = [
    { name: 'mobile-390', width: 390, height: 844, maxWidthRatio: 0.1 },
    { name: 'tablet-768', width: 768, height: 1024, minWidthRatio: 0.04, maxWidthRatio: 0.1 },
    { name: 'desktop-1280', width: 1280, height: 800, minWidthRatio: 0.04 },
];

type TGameDebugRect = { x: number; y: number; width: number; height: number };
type TGameDebugSnapshot = { player: TGameDebugRect | null; enemy: TGameDebugRect | null };

async function readSnapshot(page: Page): Promise<TGameDebugSnapshot> {
    await expect(page.getByTestId('game-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);

    // Оружие раздаётся стором синхронно при монтировании (`startGame`), а танки —
    // движком в `initPaint`, который ждёт асинхронной загрузки спрайтов
    // (`loadImages`). Два источника не гарантированно готовы к одному моменту,
    // поэтому снапшот именно опрашиваем, а не читаем один раз после боезапаса.
    let snapshot: TGameDebugSnapshot | null = null;
    await expect
        .poll(async () => {
            snapshot = await page.evaluate<TGameDebugSnapshot | null>(
                () => window.__gameDebug?.getSnapshot() ?? null,
            );
            return snapshot !== null && snapshot.player !== null && snapshot.enemy !== null;
        }, 'window.__gameDebug: оба танка созданы (initPaint завершён)')
        .toBeTruthy();
    return snapshot as unknown as TGameDebugSnapshot;
}

for (const viewport of VIEWPORTS) {
    test.describe(`Safe-зона арены — ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('оба танка целиком внутри свободной зоны (не под HUD, не под палубой)', async ({
            page,
        }) => {
            await page.goto(`/game?seed=${SEED}`);
            const snapshot = await readSnapshot(page);

            const canvasBox = await page.locator('canvas.game-canvas').boundingBox();
            const hudBox = await page.getByTestId('top-hud').boundingBox();
            const deckBox = await page.getByTestId('game-hud').boundingBox();
            if (!canvasBox) throw new Error('canvas.game-canvas не найден');
            if (!hudBox) throw new Error('top-hud не найден');
            if (!deckBox) throw new Error('game-hud (палуба) не найден');

            // Свободная зона в page-координатах: от низа HUD до верха палубы.
            const zoneTop = hudBox.y + hudBox.height;
            const zoneBottom = deckBox.y;

            for (const [label, rect] of [
                ['игрок', snapshot.player],
                ['враг', snapshot.enemy],
            ] as const) {
                if (!rect) throw new Error(`${label}: корпус не найден`);
                // bodyRect() — канвас-локальные CSS-пиксели (x, y — левый верхний
                // угол); канвас сам смещён относительно страницы safe-area-инсетами
                // `main` (game-page.tsx), поэтому переводим в page-координаты.
                const top = canvasBox.y + rect.y;
                const bottom = top + rect.height;
                expect(
                    top,
                    `${label}: верх корпуса ${top}px выше низа HUD ${zoneTop}px`,
                ).toBeGreaterThanOrEqual(zoneTop);
                expect(
                    bottom,
                    `${label}: низ корпуса ${bottom}px ниже верха палубы ${zoneBottom}px`,
                ).toBeLessThanOrEqual(zoneBottom);
            }
        });

        test('ширина танка пропорциональна ширине арены', async ({ page }) => {
            await page.goto(`/game?seed=${SEED}`);
            const snapshot = await readSnapshot(page);

            const canvasBox = await page.locator('canvas.game-canvas').boundingBox();
            if (!canvasBox) throw new Error('canvas.game-canvas не найден');

            for (const [label, rect] of [
                ['игрок', snapshot.player],
                ['враг', snapshot.enemy],
            ] as const) {
                if (!rect) throw new Error(`${label}: корпус не найден`);
                const ratio = rect.width / canvasBox.width;
                if (viewport.maxWidthRatio !== undefined) {
                    expect(
                        ratio,
                        `${label}: ширина танка ${rect.width}px — ${(ratio * 100).toFixed(1)}% от арены ${canvasBox.width}px`,
                    ).toBeLessThanOrEqual(viewport.maxWidthRatio);
                }
                if (viewport.minWidthRatio !== undefined) {
                    expect(
                        ratio,
                        `${label}: ширина танка ${rect.width}px — ${(ratio * 100).toFixed(1)}% от арены ${canvasBox.width}px`,
                    ).toBeGreaterThanOrEqual(viewport.minWidthRatio);
                }
            }
        });
    });
}
