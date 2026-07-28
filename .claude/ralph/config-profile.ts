// Профили конфига раннера (#71 → #365, трек «Фреймворк ralph», фаза 3). Вынесены из
// ralph.js: сборка плоского конфига из `common` + `profiles.<name>` — одна связная зона,
// поведение НЕ меняется, это извлечение, а не переписывание.
//
// Конфиг разделён на `common` (общее) и `profiles` (дельта). Профиль НЕ дублирует
// общие поля — иначе профили разъезжаются молча: правку modelRouting внесли в один,
// забыли во втором, и прод неделю ходит на старой модели.
//
// TS-модуль без билд-шага: исполняется нативным type stripping Node 24 (erasable-only).
//
// Фабрика, а не standalone-экспорты: дефолтный failFn всех функций — боевой fail()
// ralph.js (process.exit), а resolveProfile зовёт валидаторы соседних зон
// (assertKnownReviewModels из review.ts, #223) — фабрика захватывает их один раз,
// возвращённые функции сохраняют показательную DI (failFn параметром) — ровно так их
// зовут существующие тесты (config-profile.test.ts) и monitor.js (мягкий failFn `() => null`).

// fail() боевой уходит в process.exit(1); тестовый failFn может вернуть значение или
// бросить — поэтому возврат unknown, а не never (мягкий результат пробрасывается наверх).
type FailFn = (msg: string) => unknown;
type AssertKnownReviewModelsFn = (
    cfg: Record<string, unknown>,
    profileName: string,
    failFn?: FailFn,
) => unknown;

export type ConfigProfileEnv = {
    fail: FailFn;
    // #223: модели ревью (review.default/escalated) обязаны быть известны планке #217 —
    // валидатор живёт в review.ts, сюда приходит уже собранным из его фабрики.
    assertKnownReviewModels: AssertKnownReviewModelsFn;
};

export function isPlainObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Объекты сливаются вглубь (профиль правит ОДНУ метку modelRouting.labels, не
// переписывая блок), массивы и скаляры заменяются целиком. Частичный мердж массивов
// сознательно не делаем: для phases/authorAllowlist «дописать или заменить?» не имеет
// однозначного ответа, а неверная догадка в authorAllowlist — дыра в защите от инъекций.
// JSON.parse создаёт "__proto__" СОБСТВЕННЫМ ключом, но присваивание out[k] дёргает
// сеттер и подменяет прототип результата — в конфиге всплывают фантомные поля, которых
// в файле визуально нет. Легитимных полей с такими именами у нас не бывает, поэтому
// это либо опечатка, либо чужая рука — и то и другое для раннера с bypassPermissions
// повод остановиться, а не тихо нейтрализовать (fail-closed, как и вся схема профилей).
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

// Скан ВСЕЙ глубины, а не только уровней, куда рекурсирует мердж: объект из профиля по
// ключу, которого нет в common, копируется присваиванием — без этого обхода его нутро
// не проверялось бы вовсе, и инвариант «в конфиге не бывает опасных ключей» был бы
// ложным обещанием комментария. Возвращает имя первого найденного ключа с путём.
function findForbiddenKey(value: unknown, path: string): string | null {
    if (!isPlainObject(value)) return null;
    for (const [k, v] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.includes(k)) return `"${k}" в блоке "${path}"`;
        const deeper = findForbiddenKey(v, `${path}.${k}`);
        if (deeper) return deeper;
    }
    return null;
}

export function createConfigProfile(env: ConfigProfileEnv) {
    const { fail, assertKnownReviewModels } = env;

    // Рекурсивный мердж БЕЗ скана запрещённых ключей: findForbiddenKey уже прошёл оба
    // дерева на всю глубину в deepMerge (единожды, до мерджа), поэтому здесь повторно
    // сканировать нечего — иначе каждый уровень рекурсии перепроверял бы всё поддерево
    // заново (лишний проход на каждый уровень глубины). Никогда не зовёт failFn.
    function deepMergeInner(
        base: Record<string, unknown>,
        override: Record<string, unknown>,
    ): Record<string, unknown> {
        const out: Record<string, unknown> = { ...base };
        for (const [k, v] of Object.entries(override)) {
            if (!isPlainObject(v) || !isPlainObject(base[k])) {
                out[k] = v;
                continue;
            }
            out[k] = deepMergeInner(base[k] as Record<string, unknown>, v);
        }
        return out;
    }

    function deepMerge(
        base: Record<string, unknown>,
        override: Record<string, unknown>,
        failFn: FailFn = fail,
        basePath = 'common',
        // base — это common, override — профиль: у них РАЗНЫЕ блоки конфига, поэтому и
        // ярлыки пути разные (иначе запрещённый ключ из common всплывёт как «в блоке
        // "prod.…"» — внятность сообщения соврёт про блок). Прямые вызовы (тесты/монитор)
        // с одним path получают его для обоих аргументов — обратная совместимость.
        overridePath: string = basePath,
    ): unknown {
        // Один скан обоих деревьев на верхнем уровне (findForbiddenKey сам рекурсивен на
        // всю глубину), а не на каждом уровне мерджа. failFn мог не бросить (монитор
        // передаёт `() => null`) — тогда его результат уходит наверх, а не собирается
        // конфиг из полуфабриката (resolveProfile проверяет isPlainObject).
        const bad = findForbiddenKey(base, basePath) || findForbiddenKey(override, overridePath);
        if (bad) return failFn(`ralph.config.json: запрещённый ключ ${bad}.`);
        return deepMergeInner(base, override);
    }

    // Флаг --profile <name> | --profile=<name> (#72). Нет флага → null, дальше решает
    // defaultProfile из конфига. Флаг БЕЗ имени — стоп: это почти всегда оборванная
    // команда, а «молча ушёл в playground, когда просили prod» — ровно тот тихий сдвиг
    // режима, против которого затевались профили.
    function parseProfileFlag(argv: string[], failFn: FailFn = fail): unknown {
        // Обе формы собираем разом: при дубле (`--profile a --profile=b`) «кто победит»
        // решал бы порядок веток кода, а не намерение человека — тихий уход не в тот
        // профиль. Дубль — стоп, даже с одинаковыми именами: команда явно собрана криво.
        const hits = argv.filter((a) => a === '--profile' || a.startsWith('--profile='));
        if (hits.length === 0) return null;
        if (hits.length > 1) {
            return failFn(`Флаг --profile указан ${hits.length} раза — оставь один.`);
        }
        if (hits[0].startsWith('--profile=')) {
            const name = hits[0].slice('--profile='.length);
            // Пустое имя ИЛИ ведущий `--` (`--profile=--once`) — пропущенное имя, ровно как
            // у пробельной формы ниже: без этой проверки `--once` уехал бы в имя профиля
            // (downstream resolveProfile отверг бы «Неизвестный профиль "--once"», но
            // сообщение хуже и поведение двух форм расходится).
            if (!name || name.startsWith('--')) {
                return failFn('Флаг --profile= без имени профиля.');
            }
            return name;
        }
        const value = argv[argv.indexOf('--profile') + 1];
        // Следующий флаг вместо имени (`--profile --once`) — тоже пропущенное имя.
        if (!value || value.startsWith('--')) {
            return failFn('Флаг --profile требует имя профиля: --profile <name>.');
        }
        return value;
    }

    // #249: haltBeforeDeploy валидируется на старте — тип и место (инвариант №1: кривой
    // конфиг = fail-closed стоп, а не тихий дефолт). Решение о непрерывном prod принимает
    // строгое `cfg.haltBeforeDeploy !== false`, поэтому `"false"` (строка), `0` или `null`
    // в конфиге молча дали бы halt-режим — опечатка в типе должна валить старт, а не
    // всплывать утром остановленным треком, который человек считал непрерывным. Флаг
    // осмыслен только в профиле `prod` (пост-мердж деплой фазы 5): заданный вне prod он
    // молча ничего не значит — тоже fail, чтобы не создавать ложного ощущения непрерывности.
    // Возврат: true — валиден; иначе результат failFn (мягкий failFn пробрасываем наверх).
    function assertValidHaltBeforeDeploy(
        cfg: Record<string, unknown>,
        profileName: string,
        failFn: FailFn = fail,
    ): unknown {
        const v = cfg.haltBeforeDeploy;
        if (v === undefined) return true; // не задан — дефолт (halt), проверять нечего
        if (typeof v !== 'boolean') {
            return failFn(
                `ralph.config.json (профиль "${profileName}"): haltBeforeDeploy = ${JSON.stringify(v)} — ожидался boolean. ` +
                    `Непрерывный prod решает строгое "!== false", поэтому строка/число/null молча дали бы halt-режим (#249). ` +
                    `Убери ключ (дефолт = стоп перед деплоем) либо задай true/false.`,
            );
        }
        if (profileName !== 'prod') {
            return failFn(
                `ralph.config.json (профиль "${profileName}"): haltBeforeDeploy осмыслен только в профиле "prod" ` +
                    `(пост-мердж деплой фазы 5, #249). Вне prod флаг молча ничего не значит — убери его из этого профиля/common.`,
            );
        }
        return true;
    }

    // Fail-closed: любой изъян схемы — стоп с внятным сообщением, а не тихий дефолт.
    // Автономный раннер с bypassPermissions не имеет права УГАДЫВАТЬ, в каком режиме он
    // работает: «молча свалился в playground, думая что он prod» — худший исход из всех.
    // failFn инжектируется (как в preflight) — тесты проверяют отказы без process.exit.
    function resolveProfile(raw: unknown, name: unknown, failFn: FailFn = fail): unknown {
        if (!isPlainObject(raw)) return failFn('ralph.config.json: ожидался JSON-объект.');
        if (!isPlainObject(raw.common)) {
            return failFn('ralph.config.json: нет блока "common" — общие поля профилей.');
        }
        if (!isPlainObject(raw.profiles)) {
            return failFn('ralph.config.json: нет блока "profiles".');
        }

        const profiles = raw.profiles;
        const available = Object.keys(profiles);
        if (!available.length) return failFn('ralph.config.json: "profiles" пуст.');

        // name (флаг --profile, #72) важнее defaultProfile; нет ни того ни другого — стоп.
        const wanted = (name ?? raw.defaultProfile) as string | undefined;
        if (!wanted) {
            return failFn(
                `ralph.config.json: профиль не задан и нет "defaultProfile". Доступны: ${available.join(', ')}.`,
            );
        }
        if (!Object.prototype.hasOwnProperty.call(profiles, wanted)) {
            return failFn(`Неизвестный профиль "${wanted}". Доступны: ${available.join(', ')}.`);
        }
        if (!isPlainObject(profiles[wanted])) {
            return failFn(`ralph.config.json: профиль "${wanted}" — не объект.`);
        }

        // profileName в итоговом конфиге: раннеру и логам нужно знать режим, а исходный
        // raw после резолва никто не таскает.
        const merged = deepMerge(
            raw.common,
            profiles[wanted] as Record<string, unknown>,
            failFn,
            'common',
            wanted,
        );
        if (!isPlainObject(merged)) return merged; // мягкий failFn — наверх как есть
        // #223: модели ревью (review.default/escalated) обязаны быть известны планке #217.
        // Незнакомая модель, поставившая блок, получила бы rank -1 и проиграла ЛЮБОму
        // известному кандидату — планка инвертировалась бы (haiku судит блок сильнейшей).
        // Ловим на старте (fail-closed дешевле тихой инверсии), а не в момент разбора.
        const known = assertKnownReviewModels(merged, wanted, failFn);
        if (known !== true) return known; // мягкий failFn — наверх как есть
        // #249: haltBeforeDeploy обязан быть boolean и только в профиле prod (fail-closed,
        // иначе опечатка в типе тихо даёт halt-режим — см. assertValidHaltBeforeDeploy).
        const haltOk = assertValidHaltBeforeDeploy(merged, wanted, failFn);
        if (haltOk !== true) return haltOk; // мягкий failFn — наверх как есть
        return { ...merged, profileName: wanted };
    }

    return { deepMerge, parseProfileFlag, assertValidHaltBeforeDeploy, resolveProfile };
}
