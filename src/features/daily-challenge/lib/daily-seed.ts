const DAILY_SEED_PREFIX = 'daily';

/** Строгий формат daily-seed: `daily-YYYY-MM-DD`. */
export const DAILY_SEED_PATTERN = /^daily-\d{4}-\d{2}-\d{2}$/;

/**
 * Дневной seed «Боя дня»: детерминированная функция от даты в UTC.
 * Все игроки, зашедшие в одни и те же сутки (UTC), получают идентичный
 * seed — и, через `createSeededRandom`, идентичный террейн и ветер.
 */
export const getDailySeed = (date: Date = new Date()): string => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${DAILY_SEED_PREFIX}-${year}-${month}-${day}`;
};

/**
 * Отличает seed «Боя дня» от произвольного/случайного seed обычной игры.
 * Проверяет полный формат `daily-YYYY-MM-DD`, а не только префикс — иначе
 * произвольный `?seed=daily-что-угодно` попал бы на daily-ветку.
 */
export const isDailySeed = (seed: string): boolean => DAILY_SEED_PATTERN.test(seed);
