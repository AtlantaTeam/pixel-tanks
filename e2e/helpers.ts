import { type Page } from '@playwright/test';

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
