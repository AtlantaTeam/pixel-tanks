import { describe, expect, it } from 'vitest';
import {
    acceptedPushText,
    addedEntries,
    classifyDiff,
    evaluateBaselineChange,
    expiredEntries,
    validateNewEntry,
} from './baseline-policy.mjs';

// #207: 22.07.2026 чини-сессия гейта сама дописала в baseline 5 high-advisory и прошла
// гейт. Тесты держат ровно те свойства, ради которых правила писались: апстрим-дрейф
// проходит автономно (иначе AFK ночью встаёт на чужой уязвимости), а «сам притащил
// зависимость» и critical — не проходят никогда.

// Реальный случай 22.07: транзитивные high из Payload 3 / Next при нетронутых
// зависимостях. Держим как регресс-фикстуру — этот сценарий обязан проходить.
const UPSTREAM_DRIFT = [
    {
        id: 1124008,
        package: 'immutable',
        severity: 'high',
        reason: 'Транзитивная зависимость @payloadcms/next',
        expiresAt: '2026-08-05',
    },
    {
        id: 1124015,
        package: 'fast-uri',
        severity: 'high',
        reason: 'Транзитивная зависимость payload 3',
        expiresAt: '2026-08-05',
    },
    {
        id: 1124066,
        package: 'sharp',
        severity: 'high',
        reason: 'Фикс только в semver-major',
        expiresAt: '2026-08-05',
    },
];
const OLD = [{ id: 1121187, package: 'undici', severity: 'high', reason: 'старая запись' }];
const NOW = Date.parse('2026-07-22T09:00:00Z');

describe('classifyDiff', () => {
    it('видит правку baseline и правку зависимостей по отдельности', () => {
        const d = classifyDiff(['scripts/security-audit.baseline.json', 'src/app/page.tsx']);
        expect(d.touchesBaseline).toBe(true);
        expect(d.touchesDeps).toBe(false);
    });

    it('считает зависимостями и package.json, и package-lock.json', () => {
        expect(classifyDiff(['package.json']).touchesDeps).toBe(true);
        expect(classifyDiff(['package-lock.json']).touchesDeps).toBe(true);
    });

    it('не путает похожие пути с настоящими файлами зависимостей', () => {
        expect(classifyDiff(['docs/package.json.md', 'src/package.json.ts']).touchesDeps).toBe(
            false,
        );
    });
});

describe('addedEntries', () => {
    it('находит только новые id', () => {
        const added = addedEntries([...OLD, ...UPSTREAM_DRIFT], OLD);
        expect(added.map((a) => a.id)).toEqual([1124008, 1124015, 1124066]);
    });

    it('правка reason у существующей записи новой не считается — прав не требует', () => {
        const edited = [{ ...OLD[0], reason: 'уточнил формулировку' }];
        expect(addedEntries(edited, OLD)).toEqual([]);
    });

    it('удаление записи не считается добавлением — оно ужесточает гейт', () => {
        expect(addedEntries([], OLD)).toEqual([]);
    });
});

describe('validateNewEntry', () => {
    it('принимает запись с reason и будущим сроком', () => {
        expect(validateNewEntry(UPSTREAM_DRIFT[0], { now: NOW })).toEqual([]);
    });

    it('требует reason — запись без обоснования не признание, а протаскивание', () => {
        const bad = { ...UPSTREAM_DRIFT[0], reason: '   ' };
        expect(validateNewEntry(bad, { now: NOW }).join()).toMatch(/нет reason/);
    });

    it('требует expiresAt у любой новой записи, включая человеческую', () => {
        const bad = { ...UPSTREAM_DRIFT[0] };
        delete bad.expiresAt;
        expect(validateNewEntry(bad, { now: NOW }).join()).toMatch(/нет expiresAt/);
    });

    it('отвергает непарсящуюся дату (fail-closed, не «пропустим»)', () => {
        const bad = { ...UPSTREAM_DRIFT[0], expiresAt: 'когда-нибудь' };
        expect(validateNewEntry(bad, { now: NOW }).join()).toMatch(/не парсится/);
    });

    it('отвергает срок в прошлом — так обходили бы сам механизм TTL', () => {
        const bad = { ...UPSTREAM_DRIFT[0], expiresAt: '2020-01-01' };
        expect(validateNewEntry(bad, { now: NOW }).join()).toMatch(/уже в прошлом/);
    });
});

describe('expiredEntries', () => {
    it('находит просроченную запись', () => {
        const b = [{ id: 1, package: 'x', expiresAt: '2026-07-01' }];
        expect(expiredEntries(b, NOW)).toHaveLength(1);
    });

    it('запись без срока не просрочивается — старые ведут себя как раньше', () => {
        expect(expiredEntries(OLD, NOW)).toEqual([]);
    });
});

describe('evaluateBaselineChange', () => {
    it('апстрим-дрейф при нетронутых зависимостях принимается автономно (случай 22.07)', () => {
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, ...UPSTREAM_DRIFT],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            now: NOW,
        });
        expect(r.ok).toBe(true);
        expect(r.accepted.map((a) => a.package)).toEqual(['immutable', 'fast-uri', 'sharp']);
    });

    it('красный, когда PR правит зависимости И дописывает baseline — «сам притащил»', () => {
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, ...UPSTREAM_DRIFT],
            baseBaseline: OLD,
            changedFiles: ['package-lock.json', 'scripts/security-audit.baseline.json'],
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/меняет зависимости.*дописывает baseline/s);
    });

    it('правка зависимостей БЕЗ новых записей проходит — обычный апгрейд пакета', () => {
        const r = evaluateBaselineChange({
            headBaseline: OLD,
            baseBaseline: OLD,
            changedFiles: ['package-lock.json'],
            now: NOW,
        });
        expect(r.ok).toBe(true);
    });

    it('critical не принимается автоматически даже при нетронутых зависимостях', () => {
        const crit = {
            id: 999,
            package: 'evil',
            severity: 'critical',
            reason: 'ждём апстрим',
            expiresAt: '2026-08-05',
        };
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, crit],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/critical в baseline автоматически не принимается/);
    });

    it('новая запись без срока пересмотра красит гейт', () => {
        const noTtl = { id: 777, package: 'x', severity: 'high', reason: 'есть' };
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, noTtl],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/нет expiresAt/);
    });

    it('просроченная запись красит гейт даже без новых записей', () => {
        const stale = [
            { id: 5, package: 'old', severity: 'high', reason: 'r', expiresAt: '2026-07-01' },
        ];
        const r = evaluateBaselineChange({
            headBaseline: stale,
            baseBaseline: stale,
            changedFiles: [],
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/просрочена/);
        expect(r.expired).toHaveLength(1);
    });

    it('PR, не трогающий baseline вовсе, проходит без замечаний', () => {
        const r = evaluateBaselineChange({
            headBaseline: OLD,
            baseBaseline: OLD,
            changedFiles: ['src/app/page.tsx'],
            now: NOW,
        });
        expect(r).toMatchObject({ ok: true, accepted: [], expired: [] });
    });

    it('при ошибке ничего не считается принятым — нет частичного пропуска', () => {
        const crit = {
            id: 999,
            package: 'evil',
            severity: 'critical',
            reason: 'r',
            expiresAt: '2026-08-05',
        };
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, ...UPSTREAM_DRIFT, crit],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.accepted).toEqual([]);
    });
});

describe('acceptedPushText', () => {
    it('называет число и пакеты — человек узнаёт об ослаблении гейта сразу', () => {
        const t = acceptedPushText(UPSTREAM_DRIFT);
        expect(t).toMatch(/расширен автоматически на 3/);
        expect(t).toMatch(/immutable/);
        expect(t).toMatch(/петля продолжается/i);
    });
});
