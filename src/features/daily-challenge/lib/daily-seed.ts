const DAILY_SEED_PREFIX = 'daily';

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
