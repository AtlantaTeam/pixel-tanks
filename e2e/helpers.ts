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

/** Сколько снарядов осталось у игрока — по числу опций в селекте оружия HUD.
 *  Селект оружия — кастомный попап (не нативный `<select>`), опции в DOM живут
 *  только раскрытыми; читаем состав из `data-option-count` триггера — он актуален
 *  и в закрытом состоянии, поэтому счётчик не требует открывать список.
 *
 *  Общий хелпер для боёв (клавиатура/тач): контракт селекта един, правка не должна
 *  расходиться по копиям. */
export async function weaponCount(page: Page): Promise<number> {
    const raw = await page.locator('#weapon-select').getAttribute('data-option-count');
    return raw === null ? 0 : Number(raw);
}
