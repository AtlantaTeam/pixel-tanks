// Модуль ревью фазы (#363, трек «Фреймворк ralph», фаза 3). Вынесен из ralph.js по
// тому же приёму, что gate.ts (#362) и worktree.ts/state-lock.ts/tunnel-check.ts
// (фаза 2): вся логика выбора и планки модели ревью собрана одним связным модулем, а
// ralph.js пользуется только его API. Поведение НЕ меняется — это извлечение, не
// переписывание: роутинг модели по метке/зоне риска, фолбэк, планка повторного ревью
// (#217/#221/#223) и вызов журнала находок — всё как было.
//
// Что собрано здесь:
// - pickReviewModel — выбор модели ревью: эскалация по метке (review.escalateOn) и по
//   зоне риска диффа (review.escalateOnPaths), деградация на default при сбоях (#130);
// - pickReviewFallbackModel — отдельный от общего cfg.fallbackModel фолбэк ревью (#221);
// - REVIEW_MODEL_STRENGTH/reviewModelRank/strongerReviewModel — планка модели повторного
//   ревью (#217): повторное ревью не судится моделью слабее поставившей блок;
// - assertKnownReviewModels — fail-closed на старте: модели ревью конфига известны планке,
//   фолбэк не слабее default (#221/#223);
// - recordReviewFindings — best-effort вызов журнала находок (#169) сразу после мерджа.
//
// TS-модуль без билд-шага: исполняется нативным type stripping Node 24 (erasable-only
// синтаксис — только аннотации типов, ни enum, ни namespace, ни parameter properties).
//
// Фабрика, а не standalone-экспорты (как в gate.ts): pickReviewModel/recordReviewFindings
// не чистые — им нужен контекст ralph.js (config, ghJson, sh/shArgv/shq, log, fail,
// isPlainObject и уже определённые помощники matchRiskPaths/phaseDiffFiles). Фабрика
// захватывает этот контекст один раз, а возвращённые функции сохраняют ПОКАЗАТЕЛЬНУЮ DI:
// каждая по-прежнему принимает свои коллабораторы (cfg/ghJsonFn/shFn/…) параметром — ровно
// так их зовут существующие тесты (ralph.test.js) через ре-экспорт из ralph.js.
//
// getConfig, а не захваченный config: module-level `config` в ralph.js заполняется в main()
// ПОСЛЕ загрузки этого модуля (createReviewModule зовётся на верхнем уровне), поэтому дефолт
// `cfg = config` обязан читать ЖИВОЙ config в момент вызова, а не снимок undefined с момента
// сборки фабрики. Ленивый геттас закрывает этот разрыв (тот же приём, что state-lock.ts).

type ExecOpts = { env?: NodeJS.ProcessEnv };
type ShFn = (cmd: string, opts?: ExecOpts) => string;
type ShArgvFn = (file: string, args: string[], opts?: ExecOpts) => string;
type ShqFn = (value: unknown) => string;
type LogFn = (msg: string) => void;
type GhJsonFn = (cmd: string, attempts?: number) => unknown;
// fail() боевой уходит в process.exit(1); тестовый failFn может вернуть значение или
// бросить — поэтому возврат unknown, а не never (assertKnownReviewModels пробрасывает
// результат мягкого failFn наверх, как было в ralph.js).
type FailFn = (msg: string) => unknown;
type IsPlainObjectFn = (v: unknown) => v is Record<string, unknown>;
type MatchRiskPathsFn = (files: unknown, patterns: unknown) => string | null;
type PhaseDiffFilesFn = (
    branch: string,
    opts?: { shFn?: ShFn; runArgvFn?: ShArgvFn; logFn?: LogFn },
) => string[] | null;

type ReviewConfig = {
    default?: string;
    escalated?: string;
    fallback?: string;
    escalateOn?: unknown;
    escalateOnPaths?: unknown;
};
// Конфиг раннера в части, интересной ревью. Легаси-поле reviewModel — прежний плоский
// ключ до появления блока review (pickReviewModel деградирует на него).
type ReviewCfg = {
    review?: ReviewConfig;
    reviewModel?: string;
};

// Фаза в форме, которую хранит config.phases: recordReviewFindings берёт из неё milestone.
type Phase = { milestone: string };

export type ReviewEnv = {
    getConfig: () => ReviewCfg;
    ghJson: GhJsonFn;
    sh: ShFn;
    shArgv: ShArgvFn;
    shq: ShqFn;
    log: LogFn;
    fail: FailFn;
    isPlainObject: IsPlainObjectFn;
    matchRiskPaths: MatchRiskPathsFn;
    phaseDiffFiles: PhaseDiffFilesFn;
};

export function createReviewModule(env: ReviewEnv) {
    const {
        getConfig,
        ghJson,
        sh,
        shArgv,
        shq,
        log,
        fail,
        isPlainObject,
        matchRiskPaths,
        phaseDiffFiles,
    } = env;

    // Модель ревью фазы. Дефолт — review.default (opus).
    //
    // #130: эскалация решается по ЦЕНЕ ОШИБКИ, а не по сложности написания. Раньше
    // триггером была метка complexity:expert — но это свойство issue («тяжело писать»),
    // а ревью должно усиливаться там, где ошибка дорого стоит: деплой (мердж в main
    // катит прод автоматически), права доступа Payload, сам раннер (автономный агент
    // с bypassPermissions). Метки как триггер сохранены для обратной совместимости,
    // но в конфиге по умолчанию пусты.
    //
    // Ошибка получения диффа/меток — не фатальна: ревьюим дефолтной моделью. Это
    // по-прежнему полноценное ревью плюс гейт мерджа впереди, а fail-closed стоп тут
    // дал бы ложные ночные простои.
    function pickReviewModel(
        milestone: string,
        branch: string,
        {
            cfg = getConfig(),
            ghJsonFn = ghJson,
            shFn = sh,
            runArgvFn = shArgv,
            logFn = log,
            files: known,
        }: {
            cfg?: ReviewCfg;
            ghJsonFn?: GhJsonFn;
            shFn?: ShFn;
            runArgvFn?: ShArgvFn;
            logFn?: LogFn;
            files?: string[] | null;
        } = {},
    ): string | undefined {
        const review = cfg.review;
        if (!review) return cfg.reviewModel; // легаси-конфиг без блока review

        // Эскалация без заданной escalated-модели вернула бы undefined, а runLoop
        // трактует «нет модели» как «ревью за супервизором» и пропускает ревью ЦЕЛИКОМ
        // — fail-open ровно на самых опасных фазах (находка ревью PR #132). Поэтому
        // деградируем на default: полноценное ревью, просто не усиленное.
        const escalatedModel = () => {
            if (review.escalated) return review.escalated;
            logFn(
                '⚠ review.escalated не задан — эскалация невозможна, ревьюю моделью по умолчанию.',
            );
            return review.default;
        };

        const escalateOn = Array.isArray(review.escalateOn) ? review.escalateOn : [];
        if (escalateOn.length) {
            let all: Array<{ labels?: Array<{ name?: string }> }> = [];
            try {
                all = ghJsonFn(
                    `gh issue list --milestone ${shq(milestone)} --state all --json labels --limit 100`,
                ) as Array<{ labels?: Array<{ name?: string }> }>;
            } catch (e) {
                logFn(
                    `⚠ Не смог получить labels фазы для выбора ревью-модели: ${(e as Error).message}`,
                );
            }
            const hasComplex = all.some((i) =>
                (i.labels || []).some((l) => escalateOn.includes(l.name)),
            );
            if (hasComplex) {
                logFn('🔺 Ревью эскалировано: в фазе есть issue с меткой из review.escalateOn.');
                return escalatedModel();
            }
        }

        // files приходит извне, когда вызывающий уже собрал дифф (runLoop собирает его
        // один раз на выбор модели И на контекст ревью — иначе fetch+diff шли дважды
        // подряд, находка ревью #135).
        const files =
            known !== undefined ? known : phaseDiffFiles(branch, { shFn, runArgvFn, logFn });
        const hit = files && matchRiskPaths(files, review.escalateOnPaths);
        if (hit) {
            logFn(`🔺 Ревью эскалировано: дифф фазы трогает зону риска (${hit}).`);
            return escalatedModel();
        }
        return review.default;
    }

    // ── Фолбэк модели ревью (#221) ────────────────────────────────────────────
    // Раньше (M8) ревью-сессии шли с noFallback:true — при overload/недоступности
    // модели сессия честно падала, и сдача фазы стояла до перезапуска. С возвратом
    // fallbackModel на opus (#202) это стало убытком: honest-падение останавливало
    // фазу, хотя рядом был живой и качественный ревьюер. review.fallback — отдельный
    // от общего cfg.fallbackModel ключ: общий fallback теперь НИКАК не влияет на
    // ревью (см. buildClaudeArgs — опции.fallbackModel всегда передаётся явно).
    //
    // Дефолт при отсутствии ключа — review.default (см. #221): ревью без
    // сконфигурированного фолбэка не деградирует НИЖЕ своей обычной планки, а не
    // остаётся вовсе без фолбэка. Явное 'none' — осознанный отказ от фолбэка
    // (тогда падение при overload останется прежним fail-closed стопом).
    // #221: явное review.fallback: 'none' — ОСОЗНАННЫЙ отказ от фолбэка (honest-стоп при
    // недоступности модели, как было при M8). Возвращаем 'none' как есть, а не null: иначе
    // сигнал отказа терялся бы, и strongerReviewModel(null, floor) в повторном ревью поднял
    // бы фолбэк до планки — то есть 'none' всё равно ушёл бы с --fallback-model <floor>,
    // прямо противореча контракту (CLAUDE.md инв. 6). buildClaudeArgs строку 'none' гасит
    // (фолбэк не передаётся). Отсутствие ключа — другой случай: дефолт на review.default.
    function pickReviewFallbackModel(cfg: ReviewCfg = getConfig()): string | null {
        const review = cfg.review;
        if (!isPlainObject(review)) return null;
        const fb = review.fallback;
        if (fb === undefined || fb === null) return review.default ?? null;
        if (fb === 'none') return 'none';
        return fb;
    }

    // ── Планка модели повторного ревью (#217) ─────────────────────────────────
    // Порядок силы моделей ревью: чем правее в списке — тем сильнее. Планка нужна
    // барьеру #217: повторное ревью после разбора blocked НЕ должно судиться моделью
    // слабее той, что поставила блок, — иначе эскалацию обходят удешевлением ревьюера
    // (взять haiku после блока от fable). Список закрыт (сравниваем не любую строку):
    // неизвестная модель = ранг -1, то есть слабее любой известной.
    //
    // Ранг -1 корректен только когда неизвестен КАНДИДАТ (он проиграет известной планке).
    // Если же неизвестна модель, ПОСТАВИВШАЯ блок (floor), rank -1 инвертирует барьер:
    // floor проиграл бы любому известному кандидату, и блок сильнейшей судил бы haiku
    // (#223). Поэтому дрейф закрыт на входе: assertKnownReviewModels на валидации конфига
    // требует, чтобы review.default/escalated входили в этот список — сюда неизвестная
    // модель-ревьюер попасть уже не может (новый id модели в конфиге = fail на старте, а
    // не тихая инверсия планки в момент разбора).
    const REVIEW_MODEL_STRENGTH = [
        'claude-haiku-4-5-20251001',
        'claude-sonnet-5',
        'claude-opus-4-8',
        'claude-fable-5',
    ];

    // Ранг силы модели ревью (индекс в REVIEW_MODEL_STRENGTH). Неизвестная/пустая → -1.
    function reviewModelRank(model: unknown): number {
        return REVIEW_MODEL_STRENGTH.indexOf(model as string);
    }

    // #223: fail-closed на старте — все модели ревью конфига обязаны быть известны планке.
    // В reviewModelRank/strongerReviewModel уходят только review.default и review.escalated
    // (pickReviewModel других источников не имеет; modelRouting.* — КОДЕРСКИЕ модели, во
    // floor не попадают, поэтому их здесь не проверяем — иначе честный coder-only id ложно
    // красил бы старт). Значение 'none' и отсутствие ключа допустимы (review отключён/дефолт).
    // review.fallback (#221) проверяется тем же циклом (тот же класс дрейфа: незнакомая
    // модель фолбэка попала бы в pickReviewFallbackModel так же слепо, как раньше
    // незнакомый ревьюер — в reviewModelRank), плюс отдельно — что фолбэк не слабее
    // review.default (иначе overload тихо ослаблял бы ревью ниже базовой планки, а не
    // просто заменял модель на равнозначную/сильнее).
    // Возврат: true — все известны; иначе результат failFn (мягкий failFn пробрасываем наверх).
    function assertKnownReviewModels(
        cfg: { review?: unknown },
        profileName: string,
        failFn: FailFn = fail,
    ): unknown {
        const review = cfg.review;
        if (!isPlainObject(review)) return true; // review не задан — планке нечего проверять
        for (const key of ['default', 'escalated', 'fallback'] as const) {
            const model = review[key];
            if (model === undefined || model === null || model === 'none') continue;
            if (reviewModelRank(model) === -1) {
                return failFn(
                    `ralph.config.json (профиль "${profileName}"): review.${key} = "${model}" не входит в REVIEW_MODEL_STRENGTH. ` +
                        `Планка повторного ревью (#217) сравнивает модели по этому списку; незнакомая модель-ревьюер инвертировала бы барьер (блок сильнейшей судила бы слабейшая). ` +
                        `Добавь модель в REVIEW_MODEL_STRENGTH в review.ts или поправь конфиг. Известные: ${REVIEW_MODEL_STRENGTH.join(', ')}.`,
                );
            }
        }
        // #221: фолбэк ревью не может ослаблять ревью ниже review.default. Без этой
        // проверки overload тихо перевёл бы ревью на модель слабее базовой — ровно
        // та деградация, от которой M8 защищал жёстким noFallback.
        const fallback = review.fallback;
        const hasFallback = fallback !== undefined && fallback !== null && fallback !== 'none';
        if (
            hasFallback &&
            review.default &&
            reviewModelRank(fallback) < reviewModelRank(review.default)
        ) {
            return failFn(
                `ralph.config.json (профиль "${profileName}"): review.fallback = "${fallback}" слабее review.default = "${review.default}". ` +
                    `Фолбэк ревью (#221) не может ослаблять ревью ниже базовой планки — иначе overload тихо подменяет ревьюера на более слабого. ` +
                    `Известные модели по рангу: ${REVIEW_MODEL_STRENGTH.join(', ')}.`,
            );
        }
        return true;
    }

    // Сильнейшая из двух моделей ревью — это и есть операция «поднять планку». null /
    // undefined / 'none' у любого аргумента игнорируется (берём вторую); обе пусты → null.
    // Неизвестные строки сравниваются по rank (-1): известная всегда победит неизвестную.
    function strongerReviewModel(a: unknown, b: unknown): string | null {
        const norm = (m: unknown) => (m && m !== 'none' ? (m as string) : null);
        const x = norm(a);
        const y = norm(b);
        if (!x) return y;
        if (!y) return x;
        return reviewModelRank(x) >= reviewModelRank(y) ? x : y;
    }

    // #169: журнал находок ревью петли по severity — «ревью слабеет/крепнет» становится
    // числом (PRD `docs/ralph-reliability/prd.md` п.4). Зовётся сразу после мерджа, тем же
    // приёмом, что closeMilestoneByTitle/syncProjectBoard: best-effort, лог вместо throw —
    // косметика наблюдаемости не имеет права уронить уже смерджённую фазу. Журнал живёт в
    // рантайм-каталоге раннера (JOURNAL_PATH в scripts/review-findings-journal.mjs), не в
    // git — раннер нигде не коммитит в main напрямую, только через ревьюенные PR.
    // #252: мутация — через argv (shArgv), не строкой через шелл. Номер PR, milestone
    // и логины авторов уходят отдельными элементами argv — shq() больше не нужен для
    // закрытия инъекции (аргументы структурно не разбираются шеллом), но фильтр
    // authorAllowlist на пустые/нестроковые значения остаётся.
    function recordReviewFindings(
        phase: Phase,
        prNumber: number,
        authorAllowlist: unknown = [],
        runArgvFn: ShArgvFn = shArgv,
        logFn: LogFn = log,
    ): void {
        if (!Number.isInteger(prNumber) || prNumber <= 0) {
            logFn(`⚠ Журнал находок: номер PR неизвестен, запись пропущена.`);
            return;
        }
        // #237: прокидываем allowlist авторов в счёт — метрика считает только доверенные
        // комментарии (репо публичный).
        const authors = (Array.isArray(authorAllowlist) ? authorAllowlist : []).filter(
            (a) => typeof a === 'string' && a.trim(),
        );
        try {
            const out = runArgvFn('node', [
                'scripts/review-findings-journal.mjs',
                String(prNumber),
                phase.milestone,
                ...authors,
            ]);
            logFn(`📊 Находки ревью зафиксированы в журнале: ${String(out).trim()}`);
        } catch (e) {
            const why = String((e as Error)?.message ?? e).split('\n')[0];
            logFn(`⚠ Не смог записать находки ревью в журнал (не критично): ${why}`);
        }
    }

    return {
        pickReviewModel,
        pickReviewFallbackModel,
        REVIEW_MODEL_STRENGTH,
        reviewModelRank,
        assertKnownReviewModels,
        strongerReviewModel,
        recordReviewFindings,
    };
}
