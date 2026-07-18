/**
 * Нормализует значение seed из URL-параметра (`searchParams.seed`).
 *
 * Next.js отдаёт параметр как `string | string[] | undefined`. Для боя нужен
 * ровно один seed: пусто, повтор (`?seed=1&seed=2`) или только пробелы → `undefined`,
 * то есть каждый бой случайный. Валидное значение возвращается обрезанным и как есть —
 * `createSeededRandom` детерминированно хеширует любую строку.
 */
export const parseSeedParam = (value: string | string[] | undefined): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
};
