import { describe, expect, it } from 'vitest';
import config from './vitest.config';

// #82: порог покрытия должен реально жить в конфиге, а не быть решением "на бумаге" —
// эта проверка ловит случайный откат (кто-то удалил thresholds, вернув coverage-чек
// прод-гейта в режим "всегда зелёный отчёт").
describe('coverage thresholds в vitest.config (#82)', () => {
    // provider: 'custom' в union-типе coverage не знает про thresholds — здесь провайдер
    // всегда 'v8' (см. vitest.config.ts), приведение типа безопасно.
    const coverage = config.test?.coverage as { thresholds?: Record<string, number> };
    const thresholds = coverage?.thresholds;

    it('порог задан для всех четырёх метрик', () => {
        expect(thresholds).toBeDefined();
        expect(typeof thresholds?.lines).toBe('number');
        expect(typeof thresholds?.statements).toBe('number');
        expect(typeof thresholds?.functions).toBe('number');
        expect(typeof thresholds?.branches).toBe('number');
    });

    it('порог положительный и не выше 100% — иначе gate был бы вечно красным либо порог бессмысленным', () => {
        for (const value of Object.values(thresholds ?? {})) {
            expect(value).toBeGreaterThan(0);
            expect(value).toBeLessThanOrEqual(100);
        }
    });
});
