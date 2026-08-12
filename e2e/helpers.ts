import { expect, type Page } from '@playwright/test';

/**
 * Ждёт экран конца боя и проверяет его состав: решённый исход (победа/поражение/
 * ничья) и хотя бы одну реальную подпись статистики диалога. Диалог по handoff
 * «Game over» показывает «Урон / Точность / Выстрелов / Манёвров» — строки «HP:»
 * в нём нет (её ассертили под промежуточное состояние фазы 1 и переезд диалога на
 * статистику сломал бы e2e-чек прод-гейта). Общий хелпер для обоих боёв
 * (клавиатура/тач): проверка состава едина, правка не расходится по копиям.
 *
 * `timeoutMs` (по умолчанию 30с) — увеличивай для сценариев, где игрок мог
 * расстрелять весь боезапас без единого попадания (фиксированный угол/сила не
 * гарантирует хит на широком канвасе): матч тогда доигрывает бот один, дольше.
 */
export async function expectGameOverDialog(page: Page, timeoutMs = 30_000): Promise<void> {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: timeoutMs });
    await expect(dialog).toContainText(/Победа!|Поражение|Ничья/);
    await expect(dialog).toContainText('Урон');
}

/**
 * Доводит бой до хода бота: целится в сторону врага одной клавиатурой и делает
 * один выстрел — ход переходит боту, когда снаряд игрока разрешается. Ловим
 * переход по `arena-turn-ring` (`game-canvas.tsx`, `isBotTurn`) — он рендерится
 * безусловно (не по брейкпоинту, в отличие от `FrozenNote` в `top-hud-desktop`,
 * который на мобилке/планшете скрыт `md:hidden` и никогда не станет видимым).
 * Нужен, чтобы проверить состояния хода бота на всех вьюпортах (issue #423/
 * #424/#426): стартовый ход игрока их не покрывает.
 */
export async function reachBotTurn(page: Page): Promise<void> {
    // Бой готов (боезапас роздан) — иначе ранние нажатия уходят в no-op.
    await expect(page.getByTestId('game-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);
    // Ствол к −45° (лоб летит вправо к врагу) + чуть мощности — как в keyboard-battle.
    for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
    // arena-turn-ring появляется на весь ход бота. Space — no-op вне активного хода
    // игрока (движок гасит выстрел в полёте/на ходе бота), поэтому давим Space,
    // пока ход не перейдёт боту: ровно один выстрел, дальше давление вхолостую.
    const turnRing = page.getByTestId('arena-turn-ring');
    await expect
        .poll(
            async () => {
                await page.keyboard.press('Space');
                return turnRing.isVisible();
            },
            { timeout: 30_000, intervals: [200] },
        )
        .toBeTruthy();
}

/**
 * Повторяет `action` (нажатие клавиши / клик / тач-жест), пока у игрока не станет
 * ровно на одно оружие меньше. Каждая из трёх схем ввода — no-op вне активного
 * хода игрока (движок гасит выстрел, пока снаряд в полёте или ход бота), поэтому
 * ровно один выстрел на ход, без двойных. Возвращает новое число оружия. Общий
 * хелпер (issue #13/#426): правка выстрела в e2e не должна расходиться по копиям.
 *
 * `timeoutMs` (по умолчанию 30с) — увеличивай на широком канвасе (напр. 1920):
 * поле шире, снаряд летит дольше, и одиночный ход бота (прицел + полёт) может не
 * уложиться в стандартное окно.
 */
export async function fireOne(
    page: Page,
    action: () => Promise<void>,
    before: number,
    timeoutMs = 30_000,
): Promise<number> {
    let count = before;
    await expect
        .poll(
            async () => {
                await action();
                count = await weaponCount(page);
                return count < before;
            },
            { timeout: timeoutMs, intervals: [50] },
        )
        .toBeTruthy();
    return count;
}

/** Сколько снарядов осталось у игрока — по боезапасу селектора оружия палубы
 *  (`WeaponSelector`, `widgets/game-controls`, issue #424). Три брейкпоинт-состава
 *  палубы рендерят селектор одновременно (виден только один, CSS-переключение) —
 *  значение в них одинаковое, поэтому берём первый попавшийся, не раскрывая список.
 *
 *  Общий хелпер для боёв (клавиатура/тач): контракт селектора един, правка не должна
 *  расходиться по копиям. */
export async function weaponCount(page: Page): Promise<number> {
    const raw = await page
        .locator('[data-testid="weapon-ammo"]')
        .first()
        .getAttribute('data-ammo-count');
    return raw === null ? 0 : Number(raw);
}
