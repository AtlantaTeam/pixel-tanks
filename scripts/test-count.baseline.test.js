import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// #155: эталон числа тестов лежит в репозитории по образцу
// scripts/security-audit.baseline.json — тот же паттерн «осознанное исключение
// с reason». Сравнение с фактом — scripts/test-ratchet.mjs (#156); здесь
// проверяется только форма эталона.
const BASELINE_PATH = path.join(import.meta.dirname, 'test-count.baseline.json');

function readBaseline() {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

describe('test-count.baseline.json', () => {
    it('лежит в репозитории и парсится как JSON', () => {
        expect(() => readBaseline()).not.toThrow();
    });

    it('содержит count — неотрицательное целое', () => {
        const baseline = readBaseline();
        expect(Number.isInteger(baseline.count)).toBe(true);
        expect(baseline.count).toBeGreaterThanOrEqual(0);
    });

    it('reason, если присутствует, — непустая строка с обоснованием снижения', () => {
        const { reason } = readBaseline();
        if (reason !== undefined) {
            expect(typeof reason).toBe('string');
            expect(reason.length).toBeGreaterThan(0);
        }
    });

    it('документирует правила эталона в _readme', () => {
        const { _readme } = readBaseline();
        expect(Array.isArray(_readme)).toBe(true);
        expect(_readme.length).toBeGreaterThan(0);
        for (const line of _readme) expect(typeof line).toBe('string');
    });
});
