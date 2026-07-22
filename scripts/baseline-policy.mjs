#!/usr/bin/env node

// #207: правила изменения security-baseline.
//
// 2026-07-22, живой прогон фазы 1: чини-сессия гейта, которую не пускал красный
// `security:audit`, САМА дописала в baseline 5 high-advisory и прошла гейт. Записи были
// верными по существу (реальный апстрим-дрейф Payload/Next), но предохранитель, который
// исполнитель снимает сам, предохранителем не является. Эскалированное ревью fable этот
// дифф видело и проблему не подняло — оно отвечает на вопрос «изменение хорошее?», а не
// «автор вправе его вносить?». Значит нужен детерминированный чек, а не длинный промпт
// (наращивание инструкций ревью запрещено брифом надёжности).
//
// Требование Димы: БЕЗ обязательного человека — стоп на чужой уязвимости ночью убивает
// AFK. Поэтому правила различают два случая по фактам, а не по суждению модели:
//
//   А. Апстрим-дрейф — зависимости в этом PR не менялись. Advisory прилетели извне и
//      красят любую ветку → принимаем автоматически, но громко (пуш).
//   Б. «Сам притащил» — PR меняет package.json/package-lock.json И дописывает baseline.
//      Это «протащу свою уязвимость мимо гейта» → красный.
//
// ВАЖНО, чем это отличается от исходной формулировки задачи: поле `auto: true` как
// признак «добавлено агентом» отвергнуто намеренно. Его пишет тот же агент, значит
// как основание для прав оно ничего не стоит. Правило опирается только на то, что
// агент подделать не может: факт изменения зависимостей (git) и severity (npm audit).

const DEPENDENCY_FILES = ['package.json', 'package-lock.json'];
const BASELINE_FILE = 'scripts/security-audit.baseline.json';

// Срок пересмотра требуется от ЛЮБОЙ новой записи, не только машинной: baseline —
// признание «живём с этим», и оно не должно быть вечным. Человек посмотрит утром и
// спокойно, когда чек покраснеет, а не ночью в панике.
export const DEFAULT_TTL_DAYS = 14;

export function classifyDiff(changedFiles = []) {
    const files = changedFiles.map((f) => f.trim()).filter(Boolean);
    return {
        touchesBaseline: files.includes(BASELINE_FILE),
        touchesDeps: files.some((f) => DEPENDENCY_FILES.includes(f)),
        depFiles: files.filter((f) => DEPENDENCY_FILES.includes(f)),
    };
}

// Записи, которых не было в базовой версии файла. Сравниваем по id: перестановка строк
// или правка reason у существующей записи прав не требует, добавление нового id —
// требует. Удаление записей (протухшие) не ограничиваем: оно УЖЕСТОЧАЕТ гейт.
export function addedEntries(headBaseline = [], baseBaseline = []) {
    const known = new Set(baseBaseline.map((b) => b.id));
    return headBaseline.filter((a) => !known.has(a.id));
}

// Fail-closed по образцу security-audit.mjs: непонятная запись — стоп, не «пропустим».
export function validateNewEntry(entry, { now = 0, ttlDays = DEFAULT_TTL_DAYS } = {}) {
    const problems = [];
    if (!entry.reason || !String(entry.reason).trim()) {
        problems.push('нет reason — признание «живём с этим» должно быть обосновано');
    }
    if (!entry.expiresAt) {
        problems.push(
            `нет expiresAt — новая запись обязана иметь срок пересмотра ` +
                `(рекомендация: +${ttlDays} дней от даты добавления)`,
        );
    } else {
        const ts = Date.parse(entry.expiresAt);
        if (Number.isNaN(ts)) {
            problems.push(`expiresAt "${entry.expiresAt}" не парсится как дата`);
        } else if (ts <= now) {
            problems.push(`expiresAt "${entry.expiresAt}" уже в прошлом — так срок не ставят`);
        }
    }
    return problems;
}

// Просроченные записи красят гейт: это и есть отложенный пересмотр. Отдельно от
// «протухших» (stale) в security-audit.mjs — там апстрим починил, а тут срок вышел.
export function expiredEntries(baseline = [], now = 0) {
    return baseline.filter((b) => {
        if (!b.expiresAt) return false; // старые записи без срока — как раньше
        const ts = Date.parse(b.expiresAt);
        return !Number.isNaN(ts) && ts <= now;
    });
}

/**
 * Итоговое решение по изменению baseline в текущем PR.
 * Возвращает { ok, errors[], accepted[], expired[] } — вызывающий печатает и решает код выхода.
 */
export function evaluateBaselineChange({
    headBaseline = [],
    baseBaseline = [],
    changedFiles = [],
    now = 0,
    ttlDays = DEFAULT_TTL_DAYS,
} = {}) {
    const errors = [];
    const { touchesDeps, depFiles } = classifyDiff(changedFiles);
    const added = addedEntries(headBaseline, baseBaseline);

    // Случай Б: сам добавил зависимость — сам её и чини, а не вписывай в baseline.
    if (added.length && touchesDeps) {
        errors.push(
            `PR меняет зависимости (${depFiles.join(', ')}) И дописывает baseline ` +
                `(${added.map((a) => `${a.id} ${a.package}`).join(', ')}). ` +
                `Уязвимость, пришедшую со своей же правкой зависимостей, чинят обновлением ` +
                `или откатом пакета, а не записью в baseline.`,
        );
    }

    // critical не принимается автоматически никогда: редко, но стоит остановленной ночи.
    for (const a of added.filter((x) => x.severity === 'critical')) {
        errors.push(
            `advisory ${a.id} (${a.package}) — critical; critical в baseline автоматически ` +
                `не принимается ни при каких условиях, нужно решение человека.`,
        );
    }

    for (const a of added) {
        for (const p of validateNewEntry(a, { now, ttlDays })) {
            errors.push(`запись ${a.id} (${a.package ?? '?'}): ${p}`);
        }
    }

    const expired = expiredEntries(headBaseline, now);
    for (const e of expired) {
        errors.push(
            `запись ${e.id} (${e.package}) просрочена (expiresAt ${e.expiresAt}) — ` +
                `пересмотри: починил ли апстрим, актуально ли обоснование. ` +
                `Продлить — значит осознанно поставить новый срок.`,
        );
    }

    return { ok: errors.length === 0, errors, accepted: errors.length ? [] : added, expired };
}

// Текст пуша об автопринятии. Молчаливость была проблемой, а не автономность:
// петля идёт дальше, но человек узнаёт об ослаблении гейта сразу.
export function acceptedPushText(accepted = []) {
    const lines = accepted.map((a) => `• ${a.id} ${a.package} (${a.severity})`);
    return (
        `⚠️ Ralph: security-baseline расширен автоматически на ${accepted.length} ` +
        `advisory — зависимости в PR не менялись, это апстрим-дрейф:\n${lines.join('\n')}\n` +
        `Гейт пропущен, петля продолжается. Срок пересмотра — в expiresAt каждой записи.`
    );
}
