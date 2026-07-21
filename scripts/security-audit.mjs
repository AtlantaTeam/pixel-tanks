#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// #83: critical — нулевая терпимость (любая должна остановить и заставить разобраться
// немедленно). high — порог с запасом над текущим базовым долгом (8 на момент issue,
// все — транзитивные зависимости Payload 3 бета: undici/uuid внутри самого payload,
// не чинятся без --force на фреймворк). Presence-гейт (`npm audit --audit-level=high`)
// на сегодняшнем дереве был бы вечно красным независимо от кода PR — порог ловит РОСТ
// находок, а не сам факт сегодняшнего, пока не устранимого долга. moderate/low не
// гейтятся вовсе: это шум dev-тулчейна (vite/vitest advisories), не влияющий на прод.
export const THRESHOLDS = { critical: 0, high: 10 };

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

// Строго БОЛЬШЕ порога — порог, равный текущему значению, ещё зелёный (см. критерий
// готовности issue #83: "выше порога", не "от порога").
export function exceedsThreshold(counts, thresholds = THRESHOLDS) {
    return Object.entries(thresholds).some(([severity, max]) => (counts[severity] ?? 0) > max);
}

// npm audit возвращает ненулевой код, когда находки есть — это ОЖИДАЕМЫЙ путь, не сбой,
// поэтому spawnSync (не execSync: тот бросает на ненулевом коде). Сбой самого запуска
// (нет сети до registry и т.п.) — stdout пуст, тогда fail-closed через throw ниже.
export function runAudit(spawnFn = spawnSync) {
    const result = spawnFn('npm', ['audit', '--json'], { encoding: 'utf8' });
    if (!result.stdout) {
        throw new Error(
            `npm audit не вернул вывод (${result.error?.message ?? `код ${result.status}`})`,
        );
    }
    return JSON.parse(result.stdout);
}

function main() {
    let auditJson;
    try {
        auditJson = runAudit();
    } catch (e) {
        console.error(
            `⛔ security-audit: не смог получить/разобрать npm audit --json: ${e.message}`,
        );
        process.exit(1);
    }
    const counts = countBySeverity(auditJson);
    const summary = `critical=${counts.critical} high=${counts.high} moderate=${counts.moderate} low=${counts.low}`;
    if (exceedsThreshold(counts)) {
        console.error(
            `⛔ security-audit: находки выше порога (${summary}; порог critical>${THRESHOLDS.critical} high>${THRESHOLDS.high})`,
        );
        process.exit(1);
    }
    console.log(`✅ security-audit: в пределах порога (${summary})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
