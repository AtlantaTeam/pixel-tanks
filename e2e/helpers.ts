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

/**
 * Доводит бой до фазы полёта снаряда: тот же прицел на врага, что и `reachBotTurn`
 * (ствол к −45°, немного мощности), один выстрел — и ждёт, пока плашка хода
 * покажет «ВЫСТРЕЛ» (`phase === 'flight'`, issue #449). Полёт снаряда — отдельное
 * состояние геометрии HUD между своим ходом и ходом соперника, у которого раньше
 * не было точки входа в e2e.
 *
 * Сигналом служит `turn-pill`, а не снятый в #539 `deck-lock`: из четырёх
 * индикаторов одного состояния осталось два, и плашка хода — единственный
 * ТЕКСТОВЫЙ из них (второй — маджента-рамка арены, у неё подписи нет).
 *
 * Скоуп на мобильный HUD обязателен: пилюль в DOM ДВЕ — мобильная и десктопная
 * полосы смонтированы обе всегда (одна скрыта классом), а strict mode Playwright
 * скрытые узлы из подсчёта не исключает. Нескопленный `getByTestId('turn-pill')`
 * резолвится в два элемента и падает «strict mode violation». Берём мобильную:
 * хелпер зовут с разных вьюпортов, а этот узел смонтирован на всех, и подпись у
 * обеих пилюль одна и та же — здесь проверяется ФАЗА боя, не вёрстка.
 */
export async function reachFlightPhase(page: Page): Promise<void> {
    await expect(page.getByTestId('game-hud')).toBeVisible();
    await expect.poll(() => weaponCount(page)).toBeGreaterThan(0);
    for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('top-hud-mobile').getByTestId('turn-pill')).toContainText(
        'ВЫСТРЕЛ',
        { timeout: 10_000 },
    );
}

/** Сколько снарядов ВСЕГО осталось у игрока (всех типов) — по атрибуту
 *  `data-weapons-remaining` палубы (`widgets/game-controls`, issue #483). Берём
 *  общий боезапас, а НЕ `data-ammo-count` селектора: тот показывает боезапас
 *  выбранного типа, который скачет при авто-переключении оружия после выстрела
 *  (арсенал теперь неоднородный). Общий счётчик убывает ровно на 1 за выстрел —
 *  монотонный сигнал, на который опираются `fireOne` и проверки конца боя.
 *
 *  Общий хелпер для боёв (клавиатура/тач): контракт един, правка не расходится. */
export async function weaponCount(page: Page): Promise<number> {
    const raw = await page
        .locator('[data-testid="game-hud"]')
        .first()
        .getAttribute('data-weapons-remaining');
    return raw === null ? 0 : Number(raw);
}
