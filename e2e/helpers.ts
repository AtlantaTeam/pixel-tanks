import { expect, type Page } from '@playwright/test';

/**
 * Ждёт экран конца боя и проверяет его состав: решённый исход (победа/поражение/
 * ничья) и хотя бы одну реальную подпись статистики диалога. Диалог по handoff
 * «Game over» показывает «Урон / Точность / Выстрелов / Манёвров» — строки «HP:»
 * в нём нет (её ассертили под промежуточное состояние фазы 1 и переезд диалога на
 * статистику сломал бы e2e-чек прод-гейта). Общий хелпер для обоих боёв
 * (клавиатура/тач): проверка состава едина, правка не расходится по копиям.
 */
export async function expectGameOverDialog(page: Page): Promise<void> {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText(/Победа!|Поражение|Ничья/);
    await expect(dialog).toContainText('Урон');
}

/**
 * Доводит бой до хода бота: целится в сторону врага одной клавиатурой и делает
 * один выстрел — ход переходит боту, когда снаряд игрока разрешается. Верхний HUD
 * весь ход бота (`turn='enemy'`, обе фазы — прицеливание и полёт бота) держит
 * заметку «числа заморожены» и `FrozenNote` в десктопном ряду телеметрии — по её
 * появлению и ловим переход. Нужен, чтобы проверить раскладку хода бота на
 * переполнение (issue #423/#424): стартовый ход игрока её не покрывает.
 *
 * Требует десктопного вьюпорта (`FrozenNote` берётся из `top-hud-desktop`).
 */
export async function reachBotTurn(page: Page): Promise<void> {
    // Бой готов (боезапас роздан) — иначе ранние нажатия уходят в no-op.
    await expect(page.getByTestId('game-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);
    // Ствол к −45° (лоб летит вправо к врагу) + чуть мощности — как в keyboard-battle.
    for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
    // FrozenNote появляется на весь ход бота. Space — no-op вне активного хода
    // игрока (движок гасит выстрел в полёте/на ходе бота), поэтому давим Space,
    // пока ход не перейдёт боту: ровно один выстрел, дальше давление вхолостую.
    const frozen = page.getByTestId('top-hud-desktop').getByText(/Твои числа заморожены/);
    await expect
        .poll(
            async () => {
                await page.keyboard.press('Space');
                return frozen.isVisible();
            },
            { timeout: 30_000, intervals: [200] },
        )
        .toBeTruthy();
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
