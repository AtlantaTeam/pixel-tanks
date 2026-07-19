/**
 * Выбирает русскую форму слова по количеству.
 * `forms` — кортеж `[одна, две-четыре, пять]`, напр. `['очко', 'очка', 'очков']`.
 * Полноценная локализация с plural-правилами — фаза 10 (next-intl); это
 * промежуточный helper, чтобы текст не выглядел безграмотно до неё.
 */
export const pluralizeRu = (count: number, forms: [string, string, string]): string => {
    const abs = Math.abs(count) % 100;
    const tail = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (tail > 1 && tail < 5) return forms[1];
    if (tail === 1) return forms[0];
    return forms[2];
};
