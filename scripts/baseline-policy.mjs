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
export const MAX_TTL_DAYS = 42; // потолок: 3 × рекомендуемый срок
const DAY_MS = 24 * 60 * 60 * 1000;

export function classifyDiff(changedFiles = []) {
    const files = changedFiles.map((f) => f.trim()).filter(Boolean);
    return {
        touchesBaseline: files.includes(BASELINE_FILE),
        touchesDeps: files.some((f) => DEPENDENCY_FILES.includes(f)),
        depFiles: files.filter((f) => DEPENDENCY_FILES.includes(f)),
    };
}

// Записи, которых не было в базовой версии файла. Удаление записей не ограничиваем:
// оно УЖЕСТОЧАЕТ гейт.
export function addedEntries(headBaseline = [], baseBaseline = []) {
    const known = new Set(baseBaseline.map((b) => b.id));
    return headBaseline.filter((a) => !known.has(a.id));
}

// Правки СУЩЕСТВУЮЩИХ записей (ревью PR #208, находка 🔴 2): сверять только новые id
// мало — тем же жестом, что и в инциденте 22.07, снимаются обе заявленные гарантии.
//   • rank(severity) вверх у известной записи гасит `changed`-детект основного скана,
//     то есть critical принимается автоматически и молча;
//   • сдвиг expiresAt у просроченной записи гасит красный, который её и должен был
//     вынести на пересмотр, — TTL против агента становится беззуб.
// Поэтому: рост severity приравнивается к новой записи (со всеми правилами), а сдвиг
// срока разрешён (AFK сохраняем), но обязан попасть в пуш — «не молча» важнее.
const SEVERITY_RANK = ['info', 'low', 'moderate', 'high', 'critical'];

export function changedEntries(headBaseline = [], baseBaseline = []) {
    const base = new Map(baseBaseline.map((b) => [b.id, b]));
    const severityRaised = [];
    const ttlExtended = [];
    for (const head of headBaseline) {
        const old = base.get(head.id);
        if (!old) continue;
        if (SEVERITY_RANK.indexOf(head.severity) > SEVERITY_RANK.indexOf(old.severity)) {
            severityRaised.push({ ...head, previousSeverity: old.severity });
        }
        const oldTs = old.expiresAt ? Date.parse(old.expiresAt) : NaN;
        const newTs = head.expiresAt ? Date.parse(head.expiresAt) : NaN;
        if (!Number.isNaN(newTs) && (Number.isNaN(oldTs) || newTs > oldTs)) {
            ttlExtended.push({ ...head, previousExpiresAt: old.expiresAt ?? null });
        }
    }
    return { severityRaised, ttlExtended };
}

// #239: 23.07 четыре next-advisory ушли в baseline авто+пуш, хотя чинились патчем
// next@16.2.11 (#238) — политика различала «сам притащил» от «апстрим-дрейф», но не
// смотрела, есть ли у дрейфа готовый фикс. Апстрим-дрейф остаётся автономным ТОЛЬКО
// пока апстрим ещё не починил; если npm audit уже видит fixAvailable — это не «живём
// с этим», а «обнови зависимость», и решение снова за человеком, как с critical.
//
// npm audit кладёт fixAvailable как true (фикс без semver-major, апгрейд внутри
// текущего диапазона), объект {name, version, isSemVerMajor} (конкретная целевая
// версия, возможно мажорная) либо false (апстрим фикс ещё не выпустил).
function describeFix(fixAvailable) {
    if (!fixAvailable) return null;
    if (fixAvailable === true) return 'обновлением зависимостей (npm audit fix)';
    const target = `${fixAvailable.name}@${fixAvailable.version}`;
    return fixAvailable.isSemVerMajor
        ? `обновлением до ${target} (мажорная версия)`
        : `обновлением до ${target}`;
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
        const ceiling = now + MAX_TTL_DAYS * DAY_MS;
        if (Number.isNaN(ts)) {
            problems.push(`expiresAt "${entry.expiresAt}" не парсится как дата`);
        } else if (ts <= now) {
            problems.push(`expiresAt "${entry.expiresAt}" уже в прошлом — так срок не ставят`);
        } else if (ts > ceiling) {
            // Ревью PR #208, находка 🟠 5: без потолка «срок с запасом» (2099-01-01)
            // формально проходит правила и обнуляет весь механизм TTL.
            problems.push(
                `expiresAt "${entry.expiresAt}" дальше потолка ${MAX_TTL_DAYS} дней — ` +
                    `срок «на вырост» обнуляет пересмотр; рекомендация +${ttlDays} дней`,
            );
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
    foundAdvisoryIds = null,
    // #239: полные записи текущего скана (id + fixAvailable), не только id — нужны,
    // чтобы отличить «апстрим ещё не починил» от «фикс уже есть, просто не применили».
    foundAdvisories = null,
    now = 0,
    ttlDays = DEFAULT_TTL_DAYS,
} = {}) {
    const errors = [];
    const { touchesBaseline, touchesDeps, depFiles } = classifyDiff(changedFiles);
    const added = addedEntries(headBaseline, baseBaseline);
    const { severityRaised, ttlExtended } = changedEntries(headBaseline, baseBaseline);
    const scanById = foundAdvisories ? new Map(foundAdvisories.map((a) => [a.id, a])) : null;
    const effectiveFoundIds =
        foundAdvisoryIds ?? (foundAdvisories && foundAdvisories.map((a) => a.id));

    // Ревью PR #208, находка 🔴 1 — обход в два PR: PR №1 вписывает запись под advisory,
    // которой ещё нет (для политики это «апстрим-дрейф», для скана — безобидный stale,
    // всего лишь warning), PR №2 приносит уязвимую зависимость, baseline не трогая, и
    // проходит по уже готовой записи. Каждый шаг по отдельности легитимен.
    // Закрывается требованием: вписывать можно только advisory, которую скан ВИДИТ
    // сейчас. Легитимного повода занести ненайденную advisory не существует.
    if (effectiveFoundIds) {
        const found = new Set(effectiveFoundIds);
        for (const a of added.filter((x) => !found.has(x.id))) {
            errors.push(
                `запись ${a.id} (${a.package ?? '?'}) не соответствует ни одной advisory ` +
                    `текущего скана — запись «на вырост» под будущую уязвимость не принимается`,
            );
        }
    }

    // #239: устранимый апстрим-дрейф — не «апстрим ещё не починил», а «почини сам».
    // Автопринятие в baseline здесь означает «признаём неустранимым» то, что таковым
    // не является — ложная формулировка эффекта, ради которой заводился issue.
    if (scanById) {
        for (const a of added) {
            const fixDescription = describeFix(scanById.get(a.id)?.fixAvailable);
            if (fixDescription) {
                errors.push(
                    `advisory ${a.id} (${a.package ?? '?'}) устранима ${fixDescription} — ` +
                        `автопринятие в baseline недопустимо, нужно решение человека: обновить ` +
                        `зависимость или осознанно отклонить.`,
                );
            }
        }
    }

    // Рост severity у известной записи — то же, что новая запись: правила применяются
    // целиком, включая запрет автопринятия critical.
    for (const a of severityRaised) {
        errors.push(
            `запись ${a.id} (${a.package}): severity поднята ${a.previousSeverity} → ` +
                `${a.severity} прямо в baseline. Так гасится детект «severity выросла» ` +
                `основного скана — переоценку апстрима принимает человек.`,
        );
    }

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

    // Санити двух источников: записи изменились, а файл в диффе не помечен — значит
    // список изменённых файлов и содержимое baseline приехали из разных состояний
    // (несвежий ref, чужое дерево, битый дифф). Доверять такому сравнению нельзя.
    if ((added.length || severityRaised.length || ttlExtended.length) && !touchesBaseline) {
        errors.push(
            `записи baseline отличаются от базовой версии, но сам файл в диффе не значится — ` +
                `список изменённых файлов и содержимое приехали из разных состояний, сверка ненадёжна`,
        );
    }

    // Сдвиг срока не запрещаем — иначе просроченная запись останавливала бы петлю ночью,
    // а это ровно то, чего просили избежать. Но он обязан быть слышным: попадает в пуш
    // наравне с новыми записями (ревью PR #208, находка 🔴 2).
    //
    // #239-ревью: fixAvailable проверяется только у новых записей (added выше), но
    // продлить срок можно и записи, которую апстрим тем временем научился чинить. Само
    // продление не запрещаем (просроченная запись иначе встала бы ночью), однако помечаем
    // устранимость в тексте пуша (fixHint) — чтобы человек увидел «продлили то, что уже
    // чинится апгрейдом», а не счёл запись по-прежнему неустранимой.
    const ttlExtendedForPush = scanById
        ? ttlExtended.map((a) => {
              const fixHint = describeFix(scanById.get(a.id)?.fixAvailable);
              return fixHint ? { ...a, fixHint } : a;
          })
        : ttlExtended;
    const accepted = errors.length ? [] : [...added, ...ttlExtendedForPush];
    return { ok: errors.length === 0, errors, accepted, expired, ttlExtended };
}

// Текст пуша об автопринятии. Молчаливость была проблемой, а не автономность:
// петля идёт дальше, но человек узнаёт об ослаблении гейта сразу.
export function acceptedPushText(accepted = []) {
    const lines = accepted.map((a) =>
        a.previousExpiresAt !== undefined
            ? `• ${a.id} ${a.package} — срок продлён ${a.previousExpiresAt ?? 'без срока'} → ${a.expiresAt}` +
              (a.fixHint ? ` — устранима ${a.fixHint}, продлили то, что уже чинится апгрейдом` : '')
            : `• ${a.id} ${a.package} (${a.severity}) — новая запись до ${a.expiresAt}`,
    );
    return (
        `⚠️ Ralph: security-baseline изменён автоматически (${accepted.length}) — ` +
        `зависимости в PR не менялись, это апстрим-дрейф:\n${lines.join('\n')}\n` +
        `Гейт пропущен, петля продолжается. Проверь, что записи правда неустранимы.`
    );
}

// #239: до мерджа фазы автозапись живёт в рабочем дереве гейта, а не в коммите PR —
// каждый следующий прогон гейта видит тот же дрейф как «новый» и пересчитывает
// идентичный accepted. Без дедупа человек получал бы один и тот же пуш на каждый
// прогон (за ночь 22→23.07 пришло дважды с идентичным телом). Ключ — (id+severity):
// рост severity у той же advisory — новое событие, дедуп его пропускает намеренно.
//
// #239-ревью (🔴): продление TTL (previousExpiresAt задан changedEntries — как и в
// acceptedPushText) — самостоятельное событие, а не повтор новой записи. Если бы ключ
// продления совпадал с ключом added (`id:severity`), то запись, однажды авто-принятая и
// запушенная как новая, при позднейшем продлении срока дедупнулась бы молча — а
// гарантия «сдвиг срока разрешён, но обязан попасть в пуш» (ревью PR #208, находка 🔴 2)
// требует обратного. Поэтому ключ продления включает целевой срок: идентичный повтор
// ОДНОГО продления (#239) дедупится по совпадению expiresAt, а КАЖДОЕ новое продление —
// новый ключ → пуш.
export function pushDedupKey(entry) {
    if (entry.previousExpiresAt !== undefined) {
        return `${entry.id}:${entry.severity}:ttl:${entry.expiresAt}`;
    }
    return `${entry.id}:${entry.severity}`;
}

export function dedupeAcceptedForPush(accepted = [], alreadyPushed = []) {
    const seen = new Set(alreadyPushed);
    return accepted.filter((a) => !seen.has(pushDedupKey(a)));
}

// currentBaseline (опц.) — прореживание стора (#239-ревью 🟡): без него ключ жил бы
// вечно, и повторный дрейф advisory, которую апстрим починил и человек удалил из
// baseline, спустя месяцы дедупнулся бы молча (id стабилен). Оставляем только ключи
// записей, что ещё в baseline (id — префикс ключа до первого ':'; id advisory —
// число или GHSA-…, двоеточий не содержит), плюс свежепринятые. Так память стора
// живёт ровно столько, сколько сама запись. Без baseline — прежнее поведение (union).
export function mergePushedKeys(alreadyPushed = [], accepted = [], currentBaseline = null) {
    const fresh = accepted.map(pushDedupKey);
    if (currentBaseline == null) {
        return [...new Set([...alreadyPushed, ...fresh])];
    }
    const liveIds = new Set(currentBaseline.map((b) => String(b.id)));
    const retained = alreadyPushed.filter((k) => liveIds.has(String(k).split(':')[0]));
    return [...new Set([...retained, ...fresh])];
}
