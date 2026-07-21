#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// #83/#140: детерминированный security-скан прод-гейта.
//
// Первая версия (#83) гейтила по ЧИСЛОВОМУ порогу (critical>0, high>10 при долге 8).
// У порога два слепых пятна, найденных на ревью PR #139: PR, добавляющий одну-две новые
// high, порога не превышает и проходит молча; а когда апстрим починит текущий долг,
// находки смогут тихо отрасти обратно до десяти, оставаясь зелёными.
//
// Поэтому решение красный/зелёный принимается по СПИСКУ известных advisory-id
// (security-audit.baseline.json): красный — когда появился id, которого в baseline нет.
// Ровно те же 8 сегодняшних high остаются зелёными, но любая НОВАЯ уязвимость красит
// гейт немедленно, независимо от их числа.
//
// --omit=dev — вторая половина того же решения: гейтим прод-поверхность (то, что уедет
// на сервер), а не шум dev-тулчейна (vite/vitest advisories), который к рантайму
// отношения не имеет и только размывал порог.
const GATED_SEVERITIES = ['critical', 'high'];
const BASELINE_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'security-audit.baseline.json',
);

export function loadBaseline(readFn = readFileSync, file = BASELINE_PATH) {
    const raw = JSON.parse(readFn(file, 'utf8'));
    if (!Array.isArray(raw?.advisories)) {
        throw new Error('baseline без массива advisories — неожиданный формат');
    }
    return raw.advisories;
}

export function countBySeverity(auditJson) {
    const v = auditJson?.metadata?.vulnerabilities;
    if (!v) throw new Error('npm audit --json без metadata.vulnerabilities — неожиданный формат');
    return {
        critical: v.critical ?? 0,
        high: v.high ?? 0,
        moderate: v.moderate ?? 0,
        low: v.low ?? 0,
    };
}

// В отчёте npm корневая уязвимость лежит в via как ОБЪЕКТ (source/title/url/severity),
// а строкой в via записан лишь пакет-переносчик: одна и та же undici-дыра приезжает
// семь раз через payload, @payloadcms/next и прочих. Считать переносчиков — считать одно
// и то же по многу раз, поэтому берём только объекты и дедуплицируем по id.
export function collectAdvisories(auditJson, severities = GATED_SEVERITIES) {
    const byId = new Map();
    for (const [pkg, entry] of Object.entries(auditJson?.vulnerabilities ?? {})) {
        for (const via of entry?.via ?? []) {
            if (typeof via !== 'object' || via === null) continue;
            if (!severities.includes(via.severity)) continue;
            // id обязателен: без него запись нечем сопоставить с baseline, а молча
            // пропустить такую находку — ровно та дыра, ради которой всё затевалось.
            if (via.source === undefined || via.source === null) {
                throw new Error(
                    `advisory без source-id (пакет ${pkg}, "${via.title ?? '?'}") — нечем сверить с baseline`,
                );
            }
            if (!byId.has(via.source)) {
                byId.set(via.source, {
                    id: via.source,
                    package: via.name ?? pkg,
                    severity: via.severity,
                    title: via.title ?? '',
                    url: via.url ?? '',
                });
            }
        }
    }
    return [...byId.values()].sort((a, b) => a.id - b.id);
}

// Новые (красят гейт) и протухшие (апстрим починил — запись из baseline пора убрать,
// иначе она продолжит молча разрешать регресс с тем же id).
export function diffBaseline(advisories, baseline) {
    const known = new Set(baseline.map((b) => b.id));
    const found = new Set(advisories.map((a) => a.id));
    return {
        fresh: advisories.filter((a) => !known.has(a.id)),
        stale: baseline.filter((b) => !found.has(b.id)),
    };
}

// npm audit возвращает ненулевой код, когда находки есть — это ОЖИДАЕМЫЙ путь, не сбой,
// поэтому spawnSync (не execSync: тот бросает на ненулевом коде). Сбой самого запуска
// (нет сети до registry и т.п.) — stdout пуст, тогда fail-closed через throw ниже.
export function runAudit(spawnFn = spawnSync) {
    // maxBuffer 16 МБ: дефолт spawnSync — 1 МБ, при переполнении child убивается
    // (ENOBUFS), stdout обрезается и JSON.parse бросает → ложный красный гейт. Сегодня
    // вывод ~14 КБ, но растёт с деревом и числом находок. Те же грабли уже чинили в
    // sh() ralph.js. Дешёвая страховка.
    const result = spawnFn('npm', ['audit', '--json', '--omit=dev'], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    if (!result.stdout) {
        throw new Error(
            `npm audit не вернул вывод (${result.error?.message ?? `код ${result.status}`})`,
        );
    }
    return JSON.parse(result.stdout);
}

function main() {
    let auditJson;
    let baseline;
    try {
        auditJson = runAudit();
        baseline = loadBaseline();
    } catch (e) {
        console.error(`⛔ security-audit: ${e.message}`);
        process.exit(1);
    }

    let advisories;
    try {
        advisories = collectAdvisories(auditJson);
    } catch (e) {
        console.error(`⛔ security-audit: ${e.message}`);
        process.exit(1);
    }

    // Две разные величины, которые легко перепутать: counts из metadata — это ПАКЕТЫ
    // в свёрнутой оценке (одна дыра undici считается и за payload, и за @payloadcms/next,
    // и за остальных переносчиков), а гейт сверяет УНИКАЛЬНЫЕ advisory. Поэтому в строке
    // подписаны обе, иначе «high=8, в baseline 3» читается как потерянные пять находок.
    const counts = countBySeverity(auditJson);
    const summary =
        `гейтимых advisory: ${advisories.length}; ` +
        `затронуто пакетов: critical=${counts.critical} high=${counts.high} ` +
        `moderate=${counts.moderate} low=${counts.low}`;
    const { fresh, stale } = diffBaseline(advisories, baseline);

    // Протухшие — не повод краснеть: апстрим починил, прод стал безопаснее, ронять на
    // этом гейт абсурдно. Но и молчать нельзя, иначе baseline никогда не сожмётся.
    if (stale.length) {
        console.warn(
            `⚠️  security-audit: baseline протух — эти advisory больше не находятся, удали записи:\n` +
                stale.map((s) => `   • ${s.id} ${s.package} (${s.url})`).join('\n'),
        );
    }

    if (fresh.length) {
        console.error(
            `⛔ security-audit: новые advisory вне baseline (${summary}):\n` +
                fresh
                    .map(
                        (f) => `   • ${f.id} ${f.severity} ${f.package}: ${f.title}\n     ${f.url}`,
                    )
                    .join('\n') +
                `\nЛибо почини (npm audit fix / обнови зависимость), либо осознанно добавь ` +
                `в scripts/security-audit.baseline.json с обоснованием в reason.`,
        );
        process.exit(1);
    }

    console.log(
        `✅ security-audit: новых advisory нет (${summary}; в baseline ${baseline.length} известных)`,
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
