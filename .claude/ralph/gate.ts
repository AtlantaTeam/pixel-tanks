// Модуль гейта мерджа (#362, трек «Фреймворк ralph», фаза 3). Вынесен из ralph.js по
// тому же приёму, что worktree.ts / state-lock.ts / tunnel-check.ts (фаза 2): исполнение
// гейта фазы собрано одним связным модулем, а ralph.js пользуется только его API.
// Поведение НЕ меняется — это извлечение, не переписывание: состав чеков, порядок
// fail-fast, hold-первым-blocked-вторым, --match-head-commit, H4-разделение merge и
// пост-мердж шагов, снятие/возврат метки blocked — всё как было.
//
// Что собрано здесь: последовательность шагов гейта (checksGreen + состав чеков), логика
// перехода в blocked/hold (tryMergePhase), детерминированные помощники blocked-метки
// (removeBlockedLabel/addBlockedLabel — «переход в blocked» разбора #217/#223) и проверка
// «фаза уже смерджена» (phaseMerged/mergedPhasePr). Состав шагов (BASE/PROD_GATE_CHECKS)
// ПОКА остаётся хардкодом здесь — в конфиг он уедет в фазе 4 (#204), критерий #362 это
// прямо фиксирует. Санация env чеков живёт в отдельном gate-env.js (#188) и приходит
// сюда инжектируемым buildSanitizedGateEnv — этот модуль её только зовёт.
//
// TS-модуль без билд-шага: исполняется нативным type stripping Node 24 (erasable-only
// синтаксис — только аннотации типов, ни enum, ни namespace, ни parameter properties).
//
// Фабрика, а не standalone-экспорты (как в worktree.ts/tunnel-check.ts): checksGreen/
// tryMergePhase/… НЕ чистые — им нужен контекст ralph.js (sh/shArgv/shq, ghJson,
// findOpenPr, ensureClean, парковка/обновление дерева, санация env, sleep, DRY, набор
// regex'ов). Фабрика захватывает этот контекст один раз, а возвращённые функции
// сохраняют ПОКАЗАТЕЛЬНУЮ DI: каждая по-прежнему принимает свои коллабораторы
// (shFn/logFn/checksGreenFn/…) параметром — ровно так их зовут существующие тесты
// (gate.test.ts, blocked-scenarios.test.js, hold-scenarios.test.js) через ре-экспорт из
// ralph.js. Module-level state гейта (lastRedCheck/lastVerifiedHead/lastGatePr) живёт в
// замыкании фабрики и читается наружу геттерами — как раньше module.exports у ralph.js.

type ExecOpts = { env?: NodeJS.ProcessEnv };
type ShFn = (cmd: string, opts?: ExecOpts) => string;
type ShArgvFn = (file: string, args: string[], opts?: ExecOpts) => string;
type ShqFn = (value: unknown) => string;
type LogFn = (msg: string) => void;
type GhJsonFn = <T = unknown>(cmd: string, attempts?: number) => T;
type SafeBranchFn = (branch: string, opts?: { logFn?: LogFn; where?: string }) => boolean;
type SleepFn = (ms: number) => void;
type FormatExcerptFn = (raw: string) => string;
type BuildGateEnvFn = () => NodeJS.ProcessEnv;

// PR в форме, которую отдаёт findOpenPr (`gh pr list --json number,labels`).
type Pr = { number: number; labels?: Array<{ name: string }> };
type FindOpenPrFn = (branch: string, opts?: { ghJsonFn?: GhJsonFn; logFn?: LogFn }) => Pr | null;
type EnsureCleanFn = (context: string, opts?: { shFn?: ShFn; logFn?: LogFn }) => boolean;
type ParkFn = (opts?: { runArgvFn?: ShArgvFn; logFn?: LogFn }) => void;
type UpdateTreeFn = (runArgvFn?: ShArgvFn) => void;
type SyncDepsFn = (opts?: { env?: NodeJS.ProcessEnv }) => void;

// Один упавший чек гейта — топливо чини-сессии (self-heal). null = гейт падал не на
// чеках (fetch/HEAD/detach): такие причины кодом не лечатся.
type RedCheck = { name: string; cmd: string; excerpt: string };

// Пара [имя, команда] шага гейта. Состав пока хардкод (в конфиг — фаза 4).
type GateCheck = [string, string];

// Контекст ralph.js, захватываемый фабрикой один раз. sh/shArgv/shq/log/ghJson — те же
// module-level коллабораторы, что использует остальной раннер. safeBranch/findOpenPr/
// ensureClean/parkOnOriginMain/updateRunnerTreeToOriginMain/syncDepsIfLockChanged/
// formatExcerpt — уже определённые в ralph.js помощники хореографии. buildSanitizedGateEnv
// — санация env чеков (#188/#189, отдельный gate-env.js). sleep — ожидание между
// повторами мутации. dry — снимок DRY на момент создания фабрики (DRY иммутабелен,
// ставится из argv на старте): defense-in-depth guard C1 внутри tryMergePhase. regex'ы
// и RUNNER_TREE_FIX_HINT — константы ralph.js.
export type GateEnv = {
    sh: ShFn;
    shArgv: ShArgvFn;
    shq: ShqFn;
    log: LogFn;
    ghJson: GhJsonFn;
    safeBranch: SafeBranchFn;
    findOpenPr: FindOpenPrFn;
    ensureClean: EnsureCleanFn;
    parkOnOriginMain: ParkFn;
    updateRunnerTreeToOriginMain: UpdateTreeFn;
    syncDepsIfLockChanged: SyncDepsFn;
    buildSanitizedGateEnv: BuildGateEnvFn;
    formatExcerpt: FormatExcerptFn;
    sleep: SleepFn;
    dry: boolean;
    SHA40_RE: RegExp;
    PR_NUMBER_RE: RegExp;
    runnerTreeFixHint: string;
};

export function createGateRunner(env: GateEnv) {
    const {
        sh,
        shArgv,
        shq,
        log,
        ghJson,
        safeBranch,
        findOpenPr,
        ensureClean,
        parkOnOriginMain,
        updateRunnerTreeToOriginMain,
        syncDepsIfLockChanged,
        buildSanitizedGateEnv,
        formatExcerpt,
        sleep,
        dry: DRY,
        SHA40_RE,
        PR_NUMBER_RE,
        runnerTreeFixHint: RUNNER_TREE_FIX_HINT,
    } = env;

    // ── State гейта (замыкание фабрики) ──────────────────────────────────────
    // sha PR-головы, на которой последний прогон гейта дал ВСЕ зелёные (null = гейт не
    // доходил до зелёного финала). Отдаётся в `gh pr merge --match-head-commit`, чтобы
    // закрыть TOCTOU-окно между прогоном чеков и мерджем (#SiaTz).
    let lastVerifiedHead: string | null = null;
    // Последний упавший ЧЕК гейта (null = гейт падал не на чеках: fetch/HEAD/detach).
    // Разделение важно: чини-сессия имеет смысл только для красных чеков — сетевые
    // и git-проблемы кодом не лечатся.
    let lastRedCheck: RedCheck | null = null;
    // Номер PR последнего прохода гейта (null = гейт не дошёл до findOpenPr). #218:
    // нужен runLoop'у для текста пуша «блокер снят автоматически» — событие рождается
    // ПОСЛЕ tryMergePhase вернул строку-статус, а не объект с PR, так что номер несём
    // тем же геттер-паттерном, что lastRedCheck/lastVerifiedHead.
    let lastGatePr: number | null = null;

    // ── Блокед-метка: снятие/возврат (переход в blocked разбора #217/#223) ────

    // #217: снятие label blocked — прерогатива РАННЕРА, не кодер-сессии (тот же принцип,
    // что в #207: решение принимает не тот, кого проверяют). Раннер снимает метку ПЕРЕД
    // повторным ревью — чистый лист, — и повторное ревью (судья) вешает её заново, если
    // блокеры не устранены. #223: симметричный возврат метки нужен fail-closed'у разбора:
    // если ревью-сессия упала (overload без фолбэка/#221, api-limit, таймаут), метку надо
    // вернуть, иначе гейт следующего прохода увидит PR без метки и смерджит фазу БЕЗ
    // вердикта повторного ревью (обход барьера #217). Окно «раннер убит между снятием и
    // вердиктом» держит персистентный флаг reReviewPending (см. runLoop).
    //
    // Снятие и возврат — ЗЕРКАЛЬНЫЕ операции: тот же поиск PR, тот же фильтр PR_NUMBER_RE,
    // тот же anti-injection путь и то же fail-open поведение — различаются лишь gh-флагом и
    // текстами лога. Раньше это были два почти дословных тела (~40 строк каждое): правка
    // общей части требовала синхронного внесения в оба, и их дрейф ничем не ловился. Теперь
    // общая часть — приватный setBlockedLabel, а removeBlockedLabel/addBlockedLabel — тонкие
    // обёртки с прежней публичной сигнатурой (тесты/ре-экспорт зовут именно их).
    //
    // Идемпотентно и fail-closed: не нашли PR / не смогли снять — метка остаётся, гейт
    // увидит blocked и уведёт круг разбора дальше (в пределе — к человеку). Имя ветки —
    // только через SAFE_BRANCH_RE и shq (anti-injection, инв. C3/7). #252: сама мутация
    // (gh pr edit) — через argv (shArgv), не строкой через шелл; чтение (gh pr list)
    // остаётся на shFn (не мутация, класс риска закрыт shq — #194); DI — предохранитель #138.
    const BLOCKED_LABEL_COPY = {
        remove: {
            where: 'removeBlockedLabel',
            ghFlag: '--remove-label',
            noPr: (branch: string) =>
                `⚠ removeBlockedLabel: открытый PR ветки ${branch} не найден — метку не снимаю.`,
            badNum: (branch: string, num: string) =>
                `⚠ removeBlockedLabel: номер PR ветки ${branch} не похож на целое ('${num}') — метку не снимаю.`,
            done: (num: string) =>
                `🏷 Раннер снял label blocked с PR #${num} перед повторным ревью (#217).`,
            fail: (msg: string) =>
                `⚠ removeBlockedLabel не снял метку (гейт подберёт blocked): ${msg}`,
        },
        add: {
            where: 'addBlockedLabel',
            ghFlag: '--add-label',
            noPr: (branch: string) =>
                `⚠ addBlockedLabel: открытый PR ветки ${branch} не найден — метку не вернул.`,
            badNum: (branch: string, num: string) =>
                `⚠ addBlockedLabel: номер PR ветки ${branch} не похож на целое ('${num}') — метку не вернул.`,
            done: (num: string) =>
                `🏷 Раннер вернул label blocked на PR #${num} — повторное ревью не дало вердикта (#223).`,
            fail: (msg: string) => `⚠ addBlockedLabel не вернул метку: ${msg}`,
        },
    } as const;

    type BlockedLabelOpts = { shFn?: ShFn; runArgvFn?: ShArgvFn; logFn?: LogFn };

    function setBlockedLabel(
        branch: string,
        action: 'add' | 'remove',
        { shFn = sh, runArgvFn = shArgv, logFn = log }: BlockedLabelOpts = {},
    ): void {
        const copy = BLOCKED_LABEL_COPY[action];
        if (!safeBranch(branch, { logFn, where: copy.where })) return;
        try {
            const num = String(
                shFn(
                    `gh pr list --head ${shq(branch)} --state open --json number --jq '.[0].number // empty'`,
                ),
            ).trim();
            if (!num) {
                logFn(copy.noPr(branch));
                return;
            }
            // #251: тот же фильтр, что в findOpenPr — `--flag`-образное значение gh
            // распарсил бы как флаг. Значение из `gh pr list --jq` доверенное, но канал
            // тот же, а фильтр стоит одну строку. Fail-closed: не целое → в argv не пускаем.
            if (!PR_NUMBER_RE.test(num)) {
                logFn(copy.badNum(branch, num));
                return;
            }
            runArgvFn('gh', ['pr', 'edit', num, copy.ghFlag, 'blocked']);
            logFn(copy.done(num));
        } catch (e: unknown) {
            logFn(copy.fail(String((e as Error)?.message ?? e).split('\n')[0]));
        }
    }

    function removeBlockedLabel(branch: string, opts: BlockedLabelOpts = {}): void {
        setBlockedLabel(branch, 'remove', opts);
    }

    function addBlockedLabel(branch: string, opts: BlockedLabelOpts = {}): void {
        setBlockedLabel(branch, 'add', opts);
    }

    // ── Состав шагов гейта (пока хардкод; в конфиг — фаза 4, #204) ────────────

    const BASE_GATE_CHECKS: GateCheck[] = [
        // #190 (Изоляция ralph · Фаза 4): канарейка секретов — обязательный красный чек,
        // а не ручное измерение фазы 3 (#184). Проверяет ФАКТ, а не веру: раз чеки гейта
        // исполняются с санированным env (#188/#189), канарейка не должна находить секреты
        // петли (GH_TOKEN, CLAUDE_*, RALPH_TG_*) в env; файловый канал (~/.claude,
        // /root/ralph.env) остаётся открытым СОЗНАТЕЛЬНО — задокументированный остаточный
        // риск #192, вердикт (scripts/secret-canary-gate.mjs) на нём не краснит. Стоит
        // ПЕРВОЙ: дешевле любого другого чека (только fs.readFileSync, без vitest/npm), а
        // находка секрета важнее любой другой причины красного.
        ['security:canary', 'npm run security:canary'],
        // #156: храповик числа тестов — красит гейт, когда число собранных unit-тестов упало
        // ниже эталона (scripts/test-count.baseline.json). Закрывает класс «гейт зелёный при
        // ослабшей проверке» (кто-то удалил тесты, покрытие формально держится) — порог
        // coverage (#82) этого не ловит. Выключенные (.only/.skip) храповик НЕ ловит: vitest
        // list считает и пропущенные тесты, их детект — отдельные чеки test:only-detect (#160)
        // и test:skip-detect (#161). Стоит ПЕРВЫМ: `vitest list` (сбор без прогона) секундный,
        // а следом идут минутный build и полный `test` — fail-fast от дешёвого к дорогому,
        // красный храповик отменяет мердж, не оплатив их.
        ['test:ratchet', 'npm run test:ratchet'],
        // #160: it.only/describe.only в unit-тестах красит гейт — аналог forbidOnly Playwright
        // (playwright.config.ts, CI=1), которого у vitest нативно тоже хватает (флаг
        // --allowOnly=false, см. scripts/test-only-detect.mjs). Секундный (`vitest list`, сбор
        // без прогона, как и test:ratchet) — стоит вторым, сразу после храповика, до дорогих
        // build/test.
        //
        // ОСОЗНАННАЯ цена (ревью PR #230): это ВТОРОЙ прогон `vitest list --no-isolate` в гейте
        // (первый — внутри test:ratchet, #156), т.е. трансформ ~50 файлов app дважды, ~6с × 2 на
        // каждый прогон гейта и каждую итерацию heal-цикла. Чеки независимы по замыслу (храповик
        // считает число, only-детект проверяет --allowOnly), и держать их отдельными пунктами
        // вывода дороже объединения в один скрипт-обёртку, но яснее: красный называет ровно свою
        // причину. Объединение (собрать список раз, прогнать обе проверки) — оптимизация на потом,
        // если ~6с станут заметны; сегодня fail-fast порядок важнее секунд.
        ['test:only-detect', 'npm run test:only-detect'],
        // #161: it.skip/describe.skip в unit-тестах красит гейт — режим (а) (research.md,
        // #159): красный на ЛЮБОЙ новый skip вне точечных исключений с обоснованием
        // (scripts/skip-baseline.json). В отличие от .only, у vitest нет флага «запретить
        // .skip» — решение целиком на `git grep` (scripts/test-skip-detect.mjs), секундный,
        // стоит третьим, сразу после only-детекта, до дорогих build/test.
        ['test:skip-detect', 'npm run test:skip-detect'],
        // M1: build обязателен — ошибки next build (границы server/client, RSC-нюансы)
        // не ловятся ни tsc, ни vitest; без него в main мог уехать несобираемый код.
        ['build', 'npm run build'],
        ['lint', 'npm run lint'],
        ['lint:fsd', 'npm run lint:fsd'],
        ['typecheck', 'npm run typecheck'],
        // #232: ядро раннера (.claude/ralph/*.ts) — отдельный tsconfig под нативный type
        // stripping Node 24 (erasable-only синтаксис, nodenext-резолюция), а не под Next.js
        // (dom-либы, bundler-резолюция) из корневого typecheck — тот .ts-файлы ядра формально
        // видит по глобу **/*.ts, но не той конфигурацией, которой их реально исполняет
        // Node. Секундный (маленький модуль) — стоит рядом с typecheck, до дорогого test.
        ['typecheck:ralph', 'npm run typecheck:ralph'],
        ['test', 'npm run test --silent'],
    ];

    // «Толстые» чеки прод-профиля (#80) — дороже и медленнее базовых, поэтому в playground
    // их не гоняем. Каждый доведён своим Issue фазы 4: e2e headless на сервере (#81),
    // coverage-порог (#82), детерминированный security-скан (#83). Здесь фиксируется СОСТАВ
    // (какие чеки добавляет prod).
    //
    // e2e (#81): `CI=1` — не косметика, а сам смысл «headless на сервере, детерминированно».
    // Playwright читает CI и переключается в гейт-режим: forbidOnly (случайный `.only` не
    // протащит подмножество как зелёный гейт), reuseExistingServer=false (свой свежий dev-
    // сервер на известном порту, а не какой-то чужой процесс), retries=2 (гасит браузерный
    // джиттер, не трогая детерминизм физики — сид фиксирован в самих спеках). Репортёр в
    // playwright.config сделан независимо неблокирующим (open:never): html-репортёр по
    // умолчанию на падении поднимает сервер отчёта и ВИСИТ — тогда «красный e2e» превратился
    // бы в «зависший гейт», а не в красный. Падение → ненулевой код → checksGreen fail-closed.
    //
    // security (#83, #140): `npm run security:audit` (scripts/security-audit.mjs), НЕ голый
    // `npm audit --audit-level=high`. Presence-гейт (любая high закрашивает гейт) на
    // сегодняшнем дереве Payload 3 (бета) вечно красный: undici — транзитивная зависимость
    // самого payload, без фикса апстрима не чинится без --force (риск сломать беку). Скрипт
    // вместо этого сверяет находки `npm audit --json --omit=dev` со списком известных
    // advisory-id (scripts/security-audit.baseline.json) и краснеет, когда появился id вне
    // списка. Числовой порог (#83, high>10 при долге 8) это заменило: он пропускал одну-две
    // НОВЫЕ high молча и позволял находкам отрасти обратно после починки апстримом. Это
    // ДОБАВКА к LLM-ревью безопасности (review-промпт в tryMergePhase), не замена — оба
    // гейта независимы.
    //
    // Порядок — fail-fast (дешёвый → дорогой): security (секунды) → coverage (юнит-прогон) →
    // e2e (минуты, браузер). Красный дешёвого чека отменяет мердж, не оплатив дорогой e2e.
    const PROD_GATE_CHECKS: GateCheck[] = [
        ['security', 'npm run security:audit'],
        ['coverage', 'npm run test:coverage'],
        ['e2e', 'CI=1 npm run test:e2e'],
    ];

    // Состав гейта по активному профилю (#80). База — всем; prod дополняет толстыми чеками.
    // Селектор ТОЛЬКО собирает список — fail-closed сохранён в checksGreen: падение любого
    // чека (хоть базового, хоть прод-) по-прежнему отменяет мердж. Неизвестный/пустой профиль
    // → только база: безопасный дефолт, лишний прогон никогда не мягче нужного.
    //
    // Дедуп test↔coverage (#80): в prod базовый `test` (`vitest run`) снимается — прод-чек
    // `coverage` (`vitest run --coverage`) это тот же прогон плюс инструментация, строгое
    // надмножество. Гонять оба = лишние минуты на 300+ тестах в и без того тяжёлом гейте.
    // Атрибуция красного не теряется: упавший тест красит coverage тем же ненулевым кодом,
    // а excerpt в redCheck покажет, тест это или непокрытие порога.
    function gateChecksFor(profileName?: string): GateCheck[] {
        if (profileName === 'prod') {
            const base = BASE_GATE_CHECKS.filter(([name]) => name !== 'test');
            return [...base, ...PROD_GATE_CHECKS];
        }
        return [...BASE_GATE_CHECKS];
    }

    // ── Прогон чеков на PR-голове (#77) ──────────────────────────────────────

    function checksGreen(
        branch: string,
        prNumber: number,
        {
            shFn = sh,
            // #193: git fetch/checkout — МУТАЦИИ на пути к автодеплою, через argv (shArgv),
            // не строкой через шелл. Имя ветки и sha PR-головы уходят отдельными элементами
            // argv — shell-инъекция закрыта структурно, а не квотированием shq(). Чтение
            // (git rev-parse) остаётся на shFn — оно не мутация (обоснование — #194).
            runArgvFn = shArgv,
            ghJsonFn = ghJson,
            logFn = log,
            parkFn = parkOnOriginMain,
            syncDepsFn = syncDepsIfLockChanged,
            // env-санация чеков (#189): строит окружение по allowlist один раз на прогон
            // гейта. DI — для теста fail-closed; в проде — buildSanitizedGateEnv.
            buildGateEnvFn = buildSanitizedGateEnv,
            // Состав гейта (#80): по умолчанию база (playground). tryMergePhase прокидывает
            // сюда список по активному профилю; для prod он длиннее на толстые чеки.
            checks = BASE_GATE_CHECKS,
        }: {
            shFn?: ShFn;
            runArgvFn?: ShArgvFn;
            ghJsonFn?: GhJsonFn;
            logFn?: LogFn;
            parkFn?: ParkFn;
            syncDepsFn?: SyncDepsFn;
            buildGateEnvFn?: BuildGateEnvFn;
            checks?: GateCheck[];
        } = {},
    ): boolean {
        // Сброс СРАЗУ: любой выход из этого раунда до чеков не должен носить red-check
        // прошлого раунда — tryMergePhase иначе вернул бы 'red-checks' с устаревшей
        // ошибкой и чини-сессия чинила бы уже починенное. lastVerifiedHead тоже сбрасываем:
        // старый sha не должен доехать до --match-head-commit, если этот раунд упал до чеков.
        lastRedCheck = null;
        lastVerifiedHead = null;
        // #135: валидация ДО git — это путь к авто-мерджу в main (= автодеплой прода),
        // и он единственный оставался без проверки имени ветки.
        if (!safeBranch(branch, { logFn, where: 'гейт мерджа' })) {
            parkFn();
            return false;
        }
        try {
            runArgvFn('git', ['fetch', 'origin', branch]);
        } catch (e: unknown) {
            logFn(
                `⛔ git fetch origin ${branch} упал (${(e as Error).message}) — без свежего remote нельзя убедиться, что тестируем то, что мерджим. Авто-мердж отменён.`,
            );
            parkFn();
            return false;
        }
        let remoteHead: string;
        try {
            remoteHead = ghJsonFn<{ headRefOid: string }>(
                `gh pr view ${shq(prNumber)} --json headRefOid`,
            ).headRefOid;
        } catch (e: unknown) {
            logFn(
                `⛔ Не смог получить голову PR #${prNumber}: ${(e as Error).message} — авто-мердж отменён.`,
            );
            parkFn();
            return false;
        }
        if (!SHA40_RE.test(String(remoteHead))) {
            logFn(
                `⛔ headRefOid PR #${prNumber} не похож на sha коммита ('${remoteHead}') — авто-мердж отменён.`,
            );
            parkFn();
            return false;
        }
        // H3 в worktree-модели: чеки идут на remote-голове, но незапушенная работа не
        // должна молча теряться. refs/heads/<branch> ОБЩИЙ для всех worktree репозитория —
        // это тот самый ref, куда коммитили кодер-сессии; разошёлся с PR (push агента
        // упал; допушено с другой машины) → в main уехала бы фаза без части работы или
        // непрогнанный код. Не совпало → не мерджим. Ветки нет локально (свежая машина,
        // хвост после --delete-branch) — локальной работы нет, сверять нечего: гоняем
        // чеки на PR-голове как есть.
        let localHead: string | null = null;
        try {
            localHead = shFn(`git rev-parse --verify --quiet ${shq('refs/heads/' + branch)}`);
        } catch {}
        if (localHead && localHead !== remoteHead) {
            logFn(
                `⛔ Локальная ветка ${branch} (${localHead.slice(0, 8)}) != голова PR #${prNumber} (${remoteHead.slice(0, 8)}) — в main уехал бы не тот код, что лежит локально. Синхронизируй ветку (push/pull) и перезапусти.`,
            );
            parkFn();
            return false;
        }
        try {
            runArgvFn('git', ['checkout', '--detach', remoteHead]);
        } catch (e: unknown) {
            logFn(
                `⛔ Не смог встать на голову PR #${prNumber} (${(e as Error).message}) — авто-мердж отменён.`,
            );
            parkFn();
            return false;
        }
        // env-санация (#189): чеки и `npm ci` ниже исполняют код проверяемого PR в дереве
        // раннера, где в окружении лежат секреты петли. Строим санированный env по allowlist
        // ОДИН раз на прогон и прокидываем его и в syncDeps (npm ci), и в каждый чек. Fail-closed:
        // битый/нечитаемый allowlist → стоп, а не запуск чеков с полным env (инвариант 1).
        let gateEnv: NodeJS.ProcessEnv;
        try {
            gateEnv = buildGateEnvFn();
        } catch (e: unknown) {
            logFn(
                `⛔ Санация окружения чеков гейта не удалась (${(e as Error).message}) — чеки без allowlist не запускаем, авто-мердж отменён.`,
            );
            parkFn();
            return false;
        }
        // #SiaUX: PR-голова могла добавить зависимость (её package-lock новее, а node_modules
        // дерева раннера — старые). Переустанавливаем ДО чеков при расхождении lock, иначе
        // build/test упали бы красным на «module not found» из-за инфраструктуры, а не кода.
        syncDepsFn({ env: gateEnv });
        for (const [name, cmd] of checks) {
            try {
                shFn(cmd, { env: gateEnv });
                logFn(`  ✓ ${name}`);
            } catch (e: unknown) {
                logFn(`  ✗ ${name} — красный, авто-мердж отменён`);
                // Хвост вывода чека — топливо для чини-сессии гейта (self-heal): без
                // текста ошибки агент чинил бы вслепую. Спецсимволы безопасны — см. formatExcerpt.
                const err = e as { stdout?: string; stderr?: string; message?: string };
                const raw =
                    `${err.stdout || ''}\n${err.stderr || ''}`.trim() || String(err.message);
                lastRedCheck = {
                    name,
                    cmd,
                    excerpt: formatExcerpt(raw),
                };
                parkFn();
                return false;
            }
        }
        // Все чеки зелёные на ЭТОМ sha — запоминаем его для --match-head-commit при мердже
        // (#SiaTz): gh иначе смерджил бы голову PR НА МОМЕНТ мерджа, а не ту, что прогнали.
        lastVerifiedHead = remoteHead;
        return true;
    }

    // ── «Фаза уже смерджена?» ────────────────────────────────────────────────

    // Фаза уже смерджена (авто-мерджем прошлого прогона ИЛИ вручную человеком)?
    // Нужно, чтобы после ручного мерджа loop не зациклился на пересоздании PR, а
    // перешёл к следующей фазе. БРОСАЕТ исключение при недоступности gh (после
    // ретраев): «не смог проверить» и «не смерджена» — принципиально разные ответы;
    // молчаливый false заставил бы preflight-инвариант C4 падать с ложной причиной,
    // а loop — пересоздавать PR уже смердженной фазы.
    function phaseMerged(phase: { branch: string }): boolean {
        const merged = ghJson<Array<{ number: number }>>(
            `gh pr list --head ${shq(phase.branch)} --base main --state merged --json number --limit 1`,
        );
        return merged.length > 0;
    }

    // Номер смердженного PR фазы (или null). Нужен пути «фаза уже смерджена» (#237): там
    // recordReviewFindings не имеет lastGatePr (гейт не прогонялся — ручной мердж или рестарт
    // после merged-local-stale), а без номера авто-половина метрики терялась бы молча.
    function mergedPhasePr(phase: { branch: string }): number | null {
        const merged = ghJson<Array<{ number: number }>>(
            `gh pr list --head ${shq(phase.branch)} --base main --state merged --json number --limit 1`,
        );
        return merged.length > 0 ? merged[0].number : null;
    }

    // ── Гейт мерджа фазы ─────────────────────────────────────────────────────

    /**
     * Гейт мерджа фазы. Возвращает:
     *   'merged'             — смерджено, дерево раннера на свежем origin/main → к следующей фазе;
     *   'merged-local-stale' — PR СМЕРДЖЕН, но fetch/detach origin/main упал (H4). Раньше
     *                          merge и пост-мердж шаги жили в одном try, и лог ВРАЛ
     *                          «мердж не удался» при уже влитом PR — состояние надо
     *                          различать: восстановление другое (руками + рестарт);
     *   'hold'                — на PR label hold (#222): человек остановил PR. Проверяется
     *                          ПЕРВОЙ, впереди blocked — hold сильнее и не подлежит
     *                          авто-разбору вообще: ни чини-сессии, ни повторного ревью,
     *                          ни чеков. Раннер эту метку не снимает никогда (в отличие
     *                          от blocked, который снимает и переоценивает сам — #217) —
     *                          снять может только человек;
     *   'blocked'            — на PR label blocked (ревью нашло блокеры): цикл запустит
     *                          разбор блокеров (до blockedHealAttempts раз), потом человек;
     *   'red-checks'         — гейт упал именно на ЧЕКАХ (build/lint/.../test): это
     *                          чинится кодом → цикл запустит чини-сессию (self-heal);
     *   'not-merged'         — не мерджили по нечинимой причине (нет PR / blocked /
     *                          сеть-git проблемы / merge упал).
     *
     * DI (#77): коллабораторы с побочками и флаг dry — параметрами с дефолтами из
     * контекста фабрики, как у preflight/runLoop; в проде зовётся без deps.
     * getLastRedCheckFn — геттер, а не снимок: red-check ставится как побочка ВНУТРИ
     * checksGreen и читается после её вызова (та же причина, что у runLoop).
     */
    function tryMergePhase(
        phase: { branch: string; milestone?: string },
        {
            dry = DRY,
            shFn = sh,
            // #193: gh pr merge и пост-мердж git fetch/checkout — МУТАЦИИ, ведущие в main
            // (= автодеплой прода), через argv (shArgv), не строкой через шелл. shFn остаётся
            // для чтений/прочей хореографии (обоснование оставленного на shq — #194).
            runArgvFn = shArgv,
            logFn = log,
            ensureCleanFn = ensureClean,
            findOpenPrFn = findOpenPr,
            checksGreenFn = checksGreen,
            phaseMergedFn = phaseMerged,
            sleepFn = sleep,
            parkFn = parkOnOriginMain,
            getLastRedCheckFn = () => lastRedCheck,
            getVerifiedHeadFn = () => lastVerifiedHead,
            // Профиль (#80) решает состав гейта. runLoop прокидывает cfg.profileName; по
            // умолчанию (undefined) — только база, безопасный дефолт вне цикла.
            profileName = undefined,
        }: {
            dry?: boolean;
            shFn?: ShFn;
            runArgvFn?: ShArgvFn;
            logFn?: LogFn;
            ensureCleanFn?: EnsureCleanFn;
            findOpenPrFn?: FindOpenPrFn;
            checksGreenFn?: typeof checksGreen;
            phaseMergedFn?: (phase: { branch: string }) => boolean;
            sleepFn?: SleepFn;
            parkFn?: ParkFn;
            getLastRedCheckFn?: () => RedCheck | null;
            getVerifiedHeadFn?: () => string | null;
            profileName?: string;
        } = {},
    ): 'merged' | 'merged-local-stale' | 'hold' | 'blocked' | 'red-checks' | 'not-merged' {
        // #218: сброс СРАЗУ, тем же приёмом, что checksGreen сбрасывает lastRedCheck/
        // lastVerifiedHead — раунд, упавший ДО findOpenPr (dry/грязное дерево), не должен
        // оставлять номер PR прошлого раунда для текста пуша «блокер снят автоматически».
        lastGatePr = null;
        // C1: dry-run строго read-only. Основной guard стоит в цикле ДО вызова гейта;
        // этот — defense in depth: даже если будущая правка цикла потеряет внешний
        // guard, dry-run всё равно не смерджит и не тронет дерево раннера.
        if (dry) {
            logFn('💤 DRY: гейт мерджа пропущен — ничего не мерджим и не переключаем ветки.');
            return 'not-merged';
        }
        // M2: checkout с грязью либо упадёт, либо утащит полу-работу между коммитами.
        if (!ensureCleanFn('гейт мерджа')) return 'not-merged';
        const pr = findOpenPrFn(phase.branch);
        if (!pr) {
            logFn(
                `⛔ Гейт: открытый PR ветки ${phase.branch} в main не найден — мердж невозможен.`,
            );
            return 'not-merged';
        }
        lastGatePr = pr.number;
        // #222: hold проверяется ДО blocked — человеческий стоп-кран сильнее любого
        // автоматического вердикта. Функции, снимающей hold, в коде нет вообще (в отличие
        // от removeBlockedLabel) — это структурный барьер, не полагающийся на промпт: убрать
        // метку может только человек через `gh pr edit --remove-label hold`.
        if ((pr.labels || []).some((l) => l.name === 'hold')) {
            logFn(`⛔ Гейт: PR #${pr.number} помечен 'hold' — стоп, снять может только человек.`);
            return 'hold';
        }
        if ((pr.labels || []).some((l) => l.name === 'blocked')) {
            logFn(`⛔ Гейт: PR #${pr.number} помечен 'blocked'.`);
            return 'blocked';
        }
        if (!checksGreenFn(phase.branch, pr.number, { checks: gateChecksFor(profileName) })) {
            const redCheck = getLastRedCheckFn();
            if (redCheck) {
                logFn(`⛔ Гейт: чек ${redCheck.name} красный на PR #${pr.number}.`);
                return 'red-checks';
            }
            logFn(`⛔ Гейт: не прошёл до чеков (fetch/HEAD/detach) на PR #${pr.number}.`);
            return 'not-merged';
        }
        // H4: merge и пост-мердж шаги — РАЗНЫЕ try. Упал сам merge → PR цел, честное
        // «не удался». Merge прошёл, а обновление дерева раннера упало → это НЕ «мердж
        // не удался», а «смерджено, локалка отстала»: другой статус, другое восстановление.
        //
        // Ретрай мутации (боевой случай 2026-07-19): локальный прокси оборвал соединение
        // с GitHub API на зелёном гейте, и ночь встала из-за одного сетевого чиха.
        // Мутации вслепую не ретраим — но здесь между попытками СВЕРЯЕМСЯ phaseMerged():
        // если первый вызов на самом деле прошёл (упал только ответ) — задвоения нет.
        // #SiaTz: --match-head-commit закрывает TOCTOU-окно между прогоном чеков и мерджем.
        // checksGreen тестировал ТОЧНЫЙ sha PR-головы; за минуты чеков гейта в ветку могли
        // допушить (недобитая кодер-сессия, человек с другой машины) — без этой привязки gh
        // смерджил бы новую, НЕ прогнанную голову. Сервер отвергнет мердж, если голова уехала.
        // Пусто (мок checksGreen в тестах не выставил sha) → мерджим как раньше, без привязки.
        const verifiedHead = getVerifiedHeadFn();
        // argv (#193): номер PR и sha — отдельными элементами, не в шелл-строку. Пусто
        // (мок checksGreen в тестах не выставил sha) → мерджим без привязки, как раньше.
        const mergeArgs = ['pr', 'merge', String(pr.number), '--squash', '--delete-branch'];
        if (SHA40_RE.test(String(verifiedHead))) {
            mergeArgs.push('--match-head-commit', verifiedHead as string);
        }
        let mergedOk = false;
        for (let attempt = 1; attempt <= 2 && !mergedOk; attempt++) {
            try {
                runArgvFn('gh', mergeArgs);
                mergedOk = true;
            } catch (e: unknown) {
                try {
                    if (phaseMergedFn(phase)) {
                        // Безобидные причины ошибки при уже влитом PR: локальный ref ветки
                        // держит дерево человека, поэтому --delete-branch не смог удалить его
                        // после успешного squash (#SiaUf); либо сеть оборвала ответ на success.
                        logFn(
                            `⚠ gh pr merge #${pr.number} вернул ошибку, но PR уже влит (частая безобидная причина — ` +
                                `--delete-branch не удалил локальный ref, занятый деревом человека) — продолжаем.`,
                        );
                        mergedOk = true;
                        break;
                    }
                } catch {}
                if (attempt < 2) {
                    logFn(
                        `⚠ Мердж PR #${pr.number} не удался (${String((e as Error).message).split('\n')[0]}) — повтор через 30с.`,
                    );
                    sleepFn(30_000);
                } else {
                    logFn(
                        `⛔ Гейт: мердж PR #${pr.number} не удался (${(e as Error).message}) — оставлен человеку.`,
                    );
                    parkFn();
                    return 'not-merged';
                }
            }
        }
        // #77: локальный main не трогаем ВООБЩЕ — его ref держит дерево человека, git не
        // даст ни занять его вторым worktree, ни обновить из-под чужого checkout.
        // «Обновлённый main» раннера = свежий origin/main + detach на нём: следующая
        // фаза стартует ровно от этого коммита.
        try {
            updateRunnerTreeToOriginMain(runArgvFn);
        } catch (e: unknown) {
            logFn(
                `⚠ PR #${pr.number} СМЕРДЖЕН, но дерево раннера не обновилось (${(e as Error).message}). ` +
                    `Почини руками в дереве раннера: ${RUNNER_TREE_FIX_HINT} — ` +
                    `затем перезапусти loop (рестарт увидит фазу смердженной и продолжит со следующей).`,
            );
            return 'merged-local-stale';
        }
        logFn(`✅ PR #${pr.number} смерджен (squash), дерево раннера на свежем origin/main.`);
        return 'merged';
    }

    return {
        BASE_GATE_CHECKS,
        PROD_GATE_CHECKS,
        gateChecksFor,
        checksGreen,
        tryMergePhase,
        phaseMerged,
        mergedPhasePr,
        removeBlockedLabel,
        addBlockedLabel,
        // Геттеры module-level state гейта — наружу для runLoop/tryMergePhase (дефолтные
        // депы) и для ассертов тестов (то же, что раньше отдавал module.exports ralph.js).
        getLastRedCheck: (): RedCheck | null => lastRedCheck,
        getVerifiedHead: (): string | null => lastVerifiedHead,
        getLastGatePr: (): number | null => lastGatePr,
    };
}
