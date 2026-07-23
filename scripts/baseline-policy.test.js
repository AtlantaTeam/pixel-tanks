import { describe, expect, it } from 'vitest';
import {
    acceptedPushText,
    addedEntries,
    changedEntries,
    classifyDiff,
    dedupeAcceptedForPush,
    evaluateBaselineChange,
    expiredEntries,
    mergePushedKeys,
    pushDedupKey,
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
        expect(t).toMatch(/изменён автоматически \(3\)/);
        expect(t).toMatch(/immutable/);
        expect(t).toMatch(/петля продолжается/i);
    });

    // #239-ревью (🟡): продление срока записи, которую апстрим уже умеет чинить, — тоже
    // решение человека. Текст пуша обязан это показать (fixHint), а не выдавать запись
    // за по-прежнему неустранимую.
    it('продление устранимой записи (fixHint) — текст называет устранимость', () => {
        const t = acceptedPushText([
            {
                id: 7,
                package: 'x',
                severity: 'high',
                previousExpiresAt: '2026-07-20',
                expiresAt: '2026-08-01',
                fixHint: 'обновлением зависимостей (npm audit fix)',
            },
        ]);
        expect(t).toMatch(/срок продлён 2026-07-20 → 2026-08-01/);
        expect(t).toMatch(/уже чинится апгрейдом/);
    });
});

// Обходы, найденные ревью fable на PR #208. Каждый — сценарий нарушителя целиком,
// а не проверка отдельной функции: политика ценна ровно настолько, насколько её нельзя обойти.
describe('обходы политики (ревью PR #208)', () => {
    const FOUND = [1124008, 1124015, 1124066];

    it('🔴 1: запись «на вырост» под ещё не найденную advisory не принимается', () => {
        const future = {
            id: 4242,
            package: 'future',
            severity: 'high',
            reason: 'заранее',
            expiresAt: '2026-08-05',
        };
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, future],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            foundAdvisoryIds: FOUND,
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/не соответствует ни одной advisory текущего скана/);
    });

    it('🔴 1: запись под реально найденную advisory проходит', () => {
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, UPSTREAM_DRIFT[0]],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            foundAdvisoryIds: FOUND,
            now: NOW,
        });
        expect(r.ok).toBe(true);
    });

    it('🔴 2: поднятие severity у существующей записи красит гейт', () => {
        const base = [{ id: 7, package: 'x', severity: 'high', reason: 'r' }];
        const head = [{ ...base[0], severity: 'critical' }];
        const r = evaluateBaselineChange({
            headBaseline: head,
            baseBaseline: base,
            changedFiles: ['scripts/security-audit.baseline.json'],
            foundAdvisoryIds: [7],
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/severity поднята high → critical/);
    });

    it('🔴 2: продление срока разрешено, но обязано попасть в пуш', () => {
        const base = [
            { id: 7, package: 'x', severity: 'high', reason: 'r', expiresAt: '2026-07-20' },
        ];
        const head = [{ ...base[0], expiresAt: '2026-08-01' }];
        const r = evaluateBaselineChange({
            headBaseline: head,
            baseBaseline: base,
            changedFiles: ['scripts/security-audit.baseline.json'],
            foundAdvisoryIds: [7],
            now: NOW,
        });
        expect(r.ok).toBe(true);
        expect(r.accepted).toHaveLength(1);
        expect(acceptedPushText(r.accepted)).toMatch(/срок продлён 2026-07-20 → 2026-08-01/);
    });

    it('🟠 5: срок «на вырост» за потолком не принимается', () => {
        const far = { ...UPSTREAM_DRIFT[0], expiresAt: '2099-01-01' };
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, far],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            foundAdvisoryIds: FOUND,
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/дальше потолка/);
    });

    it('⚪ 10: записи изменились, а файла нет в диффе — источники разошлись, стоп', () => {
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, UPSTREAM_DRIFT[0]],
            baseBaseline: OLD,
            changedFiles: ['src/a.ts'],
            foundAdvisoryIds: FOUND,
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/приехали из разных состояний/);
    });

    it('снижение severity в записи гейт не красит — реальную оценку даёт скан', () => {
        const base = [{ id: 7, package: 'x', severity: 'critical', reason: 'r' }];
        const head = [{ ...base[0], severity: 'high' }];
        expect(changedEntries(head, base).severityRaised).toEqual([]);
    });
});

// #239: находка с fixAvailable из npm audit не должна молча уходить в тихий baseline —
// апстрим-дрейф без фикса остаётся автономным (случай 22.07), а устранимое обновлением
// требует решения человека наравне с critical.
describe('evaluateBaselineChange — fixAvailable (#239)', () => {
    const FOUND = [1124008, 1124015, 1124066];

    it('дрейф с fixAvailable:true не принимается автоматически', () => {
        const fixable = { ...UPSTREAM_DRIFT[0], id: 5001 };
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, fixable],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            foundAdvisories: [{ id: 5001, severity: 'high', fixAvailable: true }],
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/устранима.*npm audit fix/);
        expect(r.accepted).toEqual([]);
    });

    it('дрейф с fixAvailable-объектом называет целевую версию пакета', () => {
        const fixable = { ...UPSTREAM_DRIFT[0], id: 5002 };
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, fixable],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            foundAdvisories: [
                {
                    id: 5002,
                    severity: 'high',
                    fixAvailable: { name: 'immutable', version: '5.1.3', isSemVerMajor: false },
                },
            ],
            now: NOW,
        });
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/immutable@5\.1\.3/);
    });

    it('дрейф без фикса (fixAvailable:false) проходит как раньше — авто+TTL', () => {
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, ...UPSTREAM_DRIFT],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            foundAdvisories: UPSTREAM_DRIFT.map((a) => ({
                id: a.id,
                severity: a.severity,
                fixAvailable: false,
            })),
            now: NOW,
        });
        expect(r.ok).toBe(true);
        expect(r.accepted.map((a) => a.package)).toEqual(['immutable', 'fast-uri', 'sharp']);
    });

    // #239-ревью (🟡): fixAvailable у НОВЫХ записей краснит гейт (added выше), но
    // продлить срок можно и записи, которую апстрим тем временем научился чинить. Само
    // продление проходит (иначе просроченная встала бы ночью), однако accepted-запись
    // несёт fixHint — чтобы пуш это показал.
    it('продление TTL устранимой записи проходит, но accepted несёт fixHint', () => {
        const base = [
            { id: 7, package: 'x', severity: 'high', reason: 'r', expiresAt: '2026-07-20' },
        ];
        const head = [{ ...base[0], expiresAt: '2026-08-01' }];
        const r = evaluateBaselineChange({
            headBaseline: head,
            baseBaseline: base,
            changedFiles: ['scripts/security-audit.baseline.json'],
            foundAdvisories: [{ id: 7, severity: 'high', fixAvailable: true }],
            now: NOW,
        });
        expect(r.ok).toBe(true);
        expect(r.accepted).toHaveLength(1);
        expect(r.accepted[0].fixHint).toMatch(/npm audit fix/);
    });

    it('без переданного foundAdvisories fixAvailable не проверяется (обратная совместимость)', () => {
        const r = evaluateBaselineChange({
            headBaseline: [...OLD, ...UPSTREAM_DRIFT],
            baseBaseline: OLD,
            changedFiles: ['scripts/security-audit.baseline.json'],
            foundAdvisoryIds: FOUND,
            now: NOW,
        });
        expect(r.ok).toBe(true);
    });
});

describe('pushDedupKey / dedupeAcceptedForPush / mergePushedKeys (#239)', () => {
    it('ключ — пара id:severity', () => {
        expect(pushDedupKey({ id: 5, severity: 'high' })).toBe('5:high');
    });

    // #239-ревью (🔴): продление TTL — самостоятельное событие, ключ включает целевой
    // срок. Иначе одно продление, дедупнувшись по id:severity против ранее запушенной
    // НОВОЙ записи, молча выпало бы из пуша (нарушение гарантии PR #208 находка 🔴 2).
    it('продление TTL (previousExpiresAt задан) — ключ включает целевой срок', () => {
        expect(
            pushDedupKey({
                id: 5,
                severity: 'high',
                previousExpiresAt: null,
                expiresAt: '2026-08-01',
            }),
        ).toBe('5:high:ttl:2026-08-01');
    });

    it('продление записи, чей id:severity уже запушен как новая, — НЕ дедупится', () => {
        const extension = [
            { id: 5, severity: 'high', previousExpiresAt: '2026-07-20', expiresAt: '2026-08-01' },
        ];
        // '5:high' в сторе (запись ранее ушла как новая) — продление всё равно проходит.
        expect(dedupeAcceptedForPush(extension, ['5:high'])).toEqual(extension);
    });

    it('идентичный повтор ОДНОГО продления дедупится (тот же целевой срок)', () => {
        const extension = [
            { id: 5, severity: 'high', previousExpiresAt: '2026-07-20', expiresAt: '2026-08-01' },
        ];
        expect(dedupeAcceptedForPush(extension, ['5:high:ttl:2026-08-01'])).toEqual([]);
    });

    it('отфильтровывает уже запушенные записи по ключу', () => {
        const accepted = [
            { id: 1, severity: 'high', package: 'a' },
            { id: 2, severity: 'high', package: 'b' },
        ];
        expect(dedupeAcceptedForPush(accepted, ['1:high']).map((a) => a.id)).toEqual([2]);
    });

    it('ничего не запущено раньше — проходят все записи', () => {
        const accepted = [{ id: 1, severity: 'high', package: 'a' }];
        expect(dedupeAcceptedForPush(accepted, [])).toEqual(accepted);
    });

    it('та же advisory с ВЫРОСШЕЙ severity — это новое событие, не дедупится', () => {
        const accepted = [{ id: 1, severity: 'critical', package: 'a' }];
        expect(dedupeAcceptedForPush(accepted, ['1:high'])).toEqual(accepted);
    });

    it('mergePushedKeys добавляет новые ключи без дублей', () => {
        const merged = mergePushedKeys(
            ['1:high'],
            [
                { id: 1, severity: 'high' },
                { id: 2, severity: 'high' },
            ],
        );
        expect(merged.sort()).toEqual(['1:high', '2:high']);
    });

    // #239-ревью (🟡): без прореживания ключ жил бы вечно — после удаления записи из
    // baseline повторный дрейф той же advisory спустя месяцы дедупнулся бы молча.
    it('mergePushedKeys с baseline прореживает ключи удалённых из baseline записей', () => {
        // В сторе ключи двух записей; в baseline осталась только advisory 1.
        const merged = mergePushedKeys(['1:high', '2:high'], [], [{ id: 1, severity: 'high' }]);
        expect(merged).toEqual(['1:high']);
    });

    it('mergePushedKeys с baseline держит ttl-ключ живой записи (id — префикс до первого ":")', () => {
        const merged = mergePushedKeys(
            ['1:high:ttl:2026-08-01'],
            [],
            [{ id: 1, severity: 'high' }],
        );
        expect(merged).toEqual(['1:high:ttl:2026-08-01']);
    });

    it('mergePushedKeys без baseline — прежнее поведение (union, без прореживания)', () => {
        const merged = mergePushedKeys(['1:high', '2:high'], []);
        expect(merged.sort()).toEqual(['1:high', '2:high']);
    });
});
