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
