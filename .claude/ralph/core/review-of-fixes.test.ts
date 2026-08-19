// Юнит-тесты лестницы «ревью правок» (#625). Модуль чистый, поэтому здесь проверяется вся
// арифметика сходимости: дедуп, потолок, косметика, анти-пинг-понг, арбитр. Сквозные
// сценарии через настоящий runLoop — в tests/review-of-fixes-scenarios.test.ts.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — проектный .mjs-скрипт без деклараций типов (тот же приём, что импорт
// ralph.js в orchestrator.test.ts). Импортируется ТОЛЬКО тестом: ядро раннера обязано
// работать до `npm ci` и на scripts/ не опирается — здесь он нужен как эталон для барьера
// «набор severity ядра и метрики не разъехался».
import { SEVERITY_LEVELS } from '../../../scripts/review-findings.mjs';
import {
    backlogIssueFor,
    classifyFixReview,
    countsOf,
    decideAfterFixReview,
    disputeLabelsFor,
    emptyReviewOfFixes,
    findingKey,
    FIX_REVIEW_MAX_DISPUTES,
    FIX_REVIEW_MAX_PASSES,
    isBlockingSeverity,
    normalizeReviewOfFixes,
    pingPongIssueFor,
    severityOf,
    type FixFinding,
} from './review-of-fixes.ts';

const at = (path: string, line: number) => ({ path, line });
const f = (comment: string, anchor = at('src/a.ts', 1)): FixFinding => ({ comment, anchor });

describe('severityOf — разметка серьёзности из контракта ревью-промпта', () => {
    it('читает метку в начале комментария', () => {
        expect(severityOf('🔴 [blocker] тут теряется отказ')).toBe('blocker');
        expect(severityOf('🟠 [major] дубль логики')).toBe('major');
        expect(severityOf('🟡 [minor] нейминг')).toBe('minor');
        expect(severityOf('⚪ [nit] лишний пробел')).toBe('nit');
    });

    it('метка не в начале — не разметка, а упоминание', () => {
        expect(severityOf('это не 🔴 [blocker], а цитата')).toBe(null);
    });

    it('не строка и пустой текст — без метки', () => {
        expect(severityOf(undefined)).toBe(null);
        expect(severityOf('   ')).toBe(null);
    });

    // Барьер против дрейфа: набор severity ядра обязан совпадать с набором метрики
    // (scripts/review-findings.mjs). Импортировать её в ядро нельзя (раннер работает до
    // npm ci), поэтому дубль сторожится тестом, а не типом.
    it('набор severity совпадает с метрикой находок', () => {
        const mine = ['blocker', 'major', 'minor', 'nit'];
        expect(mine).toEqual([...SEVERITY_LEVELS]);
        expect(mine.filter((s) => isBlockingSeverity(s as 'blocker'))).toEqual([
            'blocker',
            'major',
        ]);
    });
});

describe('findingKey — дедуп между проходами', () => {
    it('одно место + тот же текст → тот же ключ', () => {
        expect(findingKey(f('🔴 [blocker] Тут  теряется   отказ'))).toBe(
            findingKey(f('🔴 [blocker] тут теряется отказ')),
        );
    });

    it('понижение серьёзности того же замечания — не новая находка', () => {
        expect(findingKey(f('🔴 [blocker] теряется отказ'))).toBe(
            findingKey(f('🟡 [minor] теряется отказ')),
        );
    });

    it('другой файл — другой ключ', () => {
        expect(findingKey(f('теряется отказ', at('src/a.ts', 1)))).not.toBe(
            findingKey(f('теряется отказ', at('src/b.ts', 1))),
        );
    });

    it('правка сдвинула строку — ключ ПРЕЖНИЙ, иначе дедуп промахивается всегда', () => {
        // Круг лестницы — это коммит в тот же файл: то же место после правки почти
        // наверняка имеет другой номер строки. Ключ с номером строки объявлял бы повтор
        // свежей находкой (двигал потолок) и делал карточку спора недостижимой.
        expect(findingKey(f('теряется отказ', at('src/a.ts', 12)))).toBe(
            findingKey(f('теряется отказ', at('src/a.ts', 87))),
        );
    });

    it('разные замечания в одном файле — разные ключи (текст в ключе не зря)', () => {
        expect(findingKey(f('🔴 [blocker] теряется отказ', at('src/a.ts', 1)))).not.toBe(
            findingKey(f('🔴 [blocker] тест не может упасть', at('src/a.ts', 1))),
        );
    });
});

describe('countsOf — счёт прохода в форме журнала находок', () => {
    it('total === сумма частей, включая unmarked', () => {
        const counts = countsOf([
            f('🔴 [blocker] раз'),
            f('🟠 [major] два'),
            f('🟡 [minor] три'),
            f('⚪ [nit] четыре'),
            f('без метки'),
        ]);
        expect(counts).toEqual({
            blocker: 1,
            major: 1,
            minor: 1,
            nit: 1,
            unmarked: 1,
            total: 5,
        });
    });

    it('пустой проход — все нули', () => {
        expect(countsOf([])).toEqual({
            blocker: 0,
            major: 0,
            minor: 0,
            nit: 0,
            unmarked: 0,
            total: 0,
        });
    });
});

describe('normalizeReviewOfFixes — состояние с диска не гарантировано ничем', () => {
    it('отсутствие поля (state прошлой версии) → пустая лестница', () => {
        expect(normalizeReviewOfFixes(undefined)).toEqual(emptyReviewOfFixes());
        expect(normalizeReviewOfFixes(null)).toEqual(emptyReviewOfFixes());
        expect(normalizeReviewOfFixes('что угодно')).toEqual(emptyReviewOfFixes());
        expect(normalizeReviewOfFixes([1, 2])).toEqual(emptyReviewOfFixes());
    });

    it('мусор в полях не роняет петлю, а трактуется как «лестница не начиналась»', () => {
        expect(
            normalizeReviewOfFixes({
                passes: -3,
                rounds: 'два',
                answered: ['a', 42, ''],
                disputes: { a: 2, b: 'нет', '': 5 },
                settled: null,
                arbitrated: 'да',
            }),
        ).toEqual({
            passes: 0,
            rounds: 0,
            answered: ['a'],
            disputes: { a: 2 },
            settled: [],
            arbitrated: false,
        });
    });

    it('валидное состояние проходит как есть', () => {
        const st = {
            passes: 2,
            rounds: 3,
            answered: ['k1'],
            disputes: { k1: 1 },
            settled: ['k2'],
            arbitrated: true,
        };
        expect(normalizeReviewOfFixes(st)).toEqual(st);
    });
});

describe('classifyFixReview — что именно принёс проход', () => {
    it('первый проход: новые blocker/major двигают потолок, minor/nit — нет', () => {
        const c = classifyFixReview(
            [
                f('🔴 [blocker] раз', at('src/a.ts', 1)),
                f('🟡 [minor] два', at('src/a.ts', 2)),
                f('⚪ [nit] три', at('src/a.ts', 3)),
            ],
            emptyReviewOfFixes(),
        );
        expect(c.freshBlocking).toHaveLength(1);
        expect(c.cosmetic).toHaveLength(2);
        expect(c.next.passes).toBe(1);
        expect(c.next.rounds).toBe(1);
    });

    it('проход из одной косметики потолок НЕ двигает', () => {
        const c = classifyFixReview(
            [f('🟡 [minor] раз', at('src/a.ts', 1)), f('⚪ [nit] два', at('src/a.ts', 2))],
            emptyReviewOfFixes(),
        );
        expect(c.freshBlocking).toHaveLength(0);
        expect(c.next.passes).toBe(0);
        expect(c.next.rounds).toBe(1);
    });

    it('сводка прохода (комментарий без якоря) находкой не считается', () => {
        const c = classifyFixReview(
            [{ comment: '🔴 [blocker] сводка: всё плохо' }, f('🟡 [minor] раз')],
            emptyReviewOfFixes(),
        );
        expect(c.fresh).toHaveLength(1);
        expect(c.freshBlocking).toHaveLength(0);
    });

    it('дубль внутри одного прохода учитывается один раз, спором не становится', () => {
        const c = classifyFixReview(
            [f('🔴 [blocker] раз'), f('🔴 [blocker] раз')],
            emptyReviewOfFixes(),
        );
        expect(c.fresh).toHaveLength(1);
        expect(c.next.disputes).toEqual({});
    });

    it('повторное blocking-замечание держит мердж, но потолок не двигает', () => {
        const first = classifyFixReview([f('🔴 [blocker] раз')], emptyReviewOfFixes());
        const second = classifyFixReview([f('🔴 [blocker] раз')], first.next);
        expect(second.freshBlocking).toHaveLength(0);
        expect(second.repeatedBlocking).toHaveLength(1);
        expect(second.next.passes).toBe(first.next.passes);
    });

    it('повторная косметика не теряется: она отдельно от свежей и от повторных блокеров', () => {
        // Сессия правок косметику видела и отклонила, ревью предъявило снова. Без
        // отдельного списка такая находка не попадала НИКУДА: ни в cosmetic (она не
        // свежая), ни в repeatedBlocking (она не блокирующая) — и терялась с мерджем.
        const first = classifyFixReview([f('🟡 [minor] нейминг')], emptyReviewOfFixes());
        const second = classifyFixReview([f('🟡 [minor] нейминг')], first.next);
        expect(second.cosmetic).toHaveLength(0);
        expect(second.repeatedBlocking).toHaveLength(0);
        expect(second.repeatedCosmetic).toHaveLength(1);
        // И потолок она по-прежнему не двигает — мердж такие замечания не держат.
        expect(second.next.passes).toBe(first.next.passes);
    });

    it('оспоренное дважды становится карточкой и больше никого не держит', () => {
        let st = emptyReviewOfFixes();
        st = classifyFixReview([f('🔴 [blocker] раз')], st).next;
        for (let i = 1; i < FIX_REVIEW_MAX_DISPUTES; i += 1) {
            st = classifyFixReview([f('🔴 [blocker] раз')], st).next;
        }
        const settling = classifyFixReview([f('🔴 [blocker] раз')], st);
        expect(settling.pingPong).toHaveLength(1);
        expect(settling.repeatedBlocking).toHaveLength(0);

        const after = classifyFixReview([f('🔴 [blocker] раз')], settling.next);
        expect(after.ignored).toHaveLength(1);
        expect(after.repeatedBlocking).toHaveLength(0);
        expect(after.freshBlocking).toHaveLength(0);
    });
});

describe('decideAfterFixReview — что делать по итогам прохода', () => {
    const clean = () => classifyFixReview([f('⚪ [nit] мелочь')], emptyReviewOfFixes());

    it('блокирующего нет → мердж', () => {
        expect(decideAfterFixReview(clean()).action).toBe('merge');
    });

    it('pr-block от сессии держит мердж, даже если разметка severity потерялась', () => {
        expect(decideAfterFixReview(clean(), { blocked: true }).action).toBe('fix');
    });

    it('новые blocker/major → ещё круг правок, пока потолок не исчерпан', () => {
        const c = classifyFixReview([f('🔴 [blocker] раз')], emptyReviewOfFixes());
        expect(decideAfterFixReview(c).action).toBe('fix');
    });

    it('потолок исчерпан → независимый арбитр, а не стоп', () => {
        let st = emptyReviewOfFixes();
        let decision;
        for (let i = 0; i < FIX_REVIEW_MAX_PASSES; i += 1) {
            const c = classifyFixReview(
                [f(`🟠 [major] находка ${String(i)}`, at('src/a.ts', i))],
                st,
            );
            decision = decideAfterFixReview(c);
            st = c.next;
        }
        expect(st.passes).toBe(FIX_REVIEW_MAX_PASSES);
        expect(decision?.action).toBe('arbiter');
    });

    it('спор без новых блокеров упирается в предохранитель кругов, а не крутится вечно', () => {
        // Каждый круг приносит НОВОЕ место, но всегда одно и то же: потолок passes
        // растёт, поэтому сюда доезжает круговой предохранитель только при чередовании.
        let st = { ...emptyReviewOfFixes(), rounds: FIX_REVIEW_MAX_PASSES * 2 - 1, passes: 1 };
        const c = classifyFixReview([f('🔴 [blocker] спорное', at('src/a.ts', 9))], st);
        expect(decideAfterFixReview(c).action).toBe('arbiter');
    });

    it('арбитр уже отработал → ПОВТОРНОЕ замечание мердж не держит, второй раз петлю не крутим', () => {
        const first = classifyFixReview([f('🔴 [blocker] раз')], emptyReviewOfFixes());
        const again = classifyFixReview([f('🔴 [blocker] раз')], {
            ...first.next,
            arbitrated: true,
        });
        expect(again.repeatedBlocking).toHaveLength(1);
        expect(again.freshBlocking).toHaveLength(0);
        expect(decideAfterFixReview(again).action).toBe('merge');
    });

    // #630: `arbitrated` живёт на диске и переживает рестарт процесса, а `submitted`
    // выставляется ПОЗЖЕ него — то есть после падения в этом окне рестарт гонит весь цикл
    // сдачи заново, и лестница получает СВЕЖИЙ код с унаследованным флагом. Безусловный
    // мердж по флагу увёл бы блокер, которого арбитр никогда не видел, прямо в main.
    it('арбитр отработал, но находка СВЕЖАЯ → барьер не обходится (потолок исчерпан → арбитр)', () => {
        const c = classifyFixReview([f('🔴 [blocker] регрессия нового круга', at('src/b.ts', 5))], {
            ...emptyReviewOfFixes(),
            arbitrated: true,
            passes: FIX_REVIEW_MAX_PASSES,
        });
        expect(c.freshBlocking).toHaveLength(1);
        expect(decideAfterFixReview(c).action).toBe('arbiter');
    });

    it('арбитр отработал, находка свежая, потолок ещё есть → круг правок, а не мердж', () => {
        const c = classifyFixReview([f('🔴 [blocker] регрессия нового круга', at('src/b.ts', 5))], {
            ...emptyReviewOfFixes(),
            arbitrated: true,
        });
        expect(decideAfterFixReview(c).action).toBe('fix');
    });

    it('арбитр отработал, повтор + просьба сессии о блоке → всё равно мердж, а не круг', () => {
        // Вход обязан ДОЙТИ до ветки `next.arbitrated`, иначе тест зелен и при её полном
        // удалении. Поэтому: повторная блокирующая находка (мимо первой ветки — blocking
        // непуст) И `blocked: true` (мимо неё же по второму условию).
        //
        // Сторожим осознанную трактовку: просьба сессии о метке ПОСЛЕ вердикта арбитра
        // лестницей гасится — крутить круг правок по тому, что арбитр уже разобрал, значит
        // вернуть стоп, ради отмены которого он и заведён. Мердж при этом всё равно не
        // пройдёт: метку `blocked` ставит `applySessionRequests`, и её видит гейт.
        const first = classifyFixReview([f('🔴 [blocker] спорное место')], emptyReviewOfFixes());
        const again = classifyFixReview([f('🔴 [blocker] спорное место')], {
            ...first.next,
            arbitrated: true,
        });
        expect(again.repeatedBlocking).toHaveLength(1);
        expect(again.freshBlocking).toHaveLength(0);
        expect(decideAfterFixReview(again, { blocked: true }).action).toBe('merge');
    });
});

describe('карточки: незакрытая косметика и закрытый спор', () => {
    it('косметика — карточка со ссылкой на PR, якорем и критерием готовности', () => {
        const c = classifyFixReview(
            [f('🟡 [minor] нейминг хромает', at('src/a.ts', 12))],
            emptyReviewOfFixes(),
        );
        const issue = backlogIssueFor(c.cosmetic[0], {
            milestone: 'M1',
            pr: 42,
            labels: ['complexity:low', 'area:core', 'backlog'],
        });
        expect(issue.title).toContain('нейминг хромает');
        expect(issue.body).toContain('PR #42');
        expect(issue.body).toContain('src/a.ts:12');
        expect(issue.body).toContain('Критерий готовности');
        expect(issue.labels).toEqual(['complexity:low', 'area:core', 'backlog']);
    });

    it('длинный текст замечания обрезается в заголовке, но целиком лежит в теле', () => {
        const long = `🟡 [minor] ${'очень длинное замечание '.repeat(20)}`;
        const c = classifyFixReview([f(long)], emptyReviewOfFixes());
        const issue = backlogIssueFor(c.cosmetic[0], { milestone: 'M1', pr: 1 });
        expect(issue.title.length).toBeLessThanOrEqual(90);
        expect(issue.body).toContain(long);
    });

    it('карточка после арбитра объясняет ДРУГУЮ причину, чем карточка косметики', () => {
        const c = classifyFixReview(
            [f('🔴 [blocker] спорное', at('src/a.ts', 3))],
            emptyReviewOfFixes(),
        );
        const arb = backlogIssueFor(c.freshBlocking[0], {
            milestone: 'M1',
            pr: 42,
            context: 'arbiter',
        });
        expect(arb.body).toMatch(/арбитр.*не воспроизвёл/s);
        // Про «такие замечания мердж не держат» здесь нельзя: blocker его как раз держит,
        // а отпустил его вердикт арбитра. Один текст на два пути соврал бы человеку.
        expect(arb.body).not.toMatch(/держат только blocker и major/);

        const cosmetic = backlogIssueFor(c.freshBlocking[0], { milestone: 'M1', pr: 42 });
        expect(cosmetic.body).toMatch(/держат только blocker и major/);
    });

    it('спор — карточка с ОБЕИМИ позициями', () => {
        const c = classifyFixReview(
            [f('🔴 [blocker] спорное', at('src/a.ts', 3))],
            emptyReviewOfFixes(),
        );
        const issue = pingPongIssueFor(c.fresh[0], { milestone: 'M1', pr: 42, disputes: 2 });
        expect(issue.body).toContain('Позиция ревью');
        expect(issue.body).toContain('Позиция правок');
        expect(issue.body).toContain('PR #42');
    });

    it('номер PR неизвестен — карточка всё равно указывает место', () => {
        const c = classifyFixReview([f('🟡 [minor] раз', at('src/a.ts', 7))], emptyReviewOfFixes());
        const issue = backlogIssueFor(c.cosmetic[0], { milestone: 'M1', pr: null });
        expect(issue.body).toContain('src/a.ts:7');
        expect(issue.body).not.toContain('PR #');
    });
});

describe('disputeLabelsFor — метка роутинга у спорной карточки ЗАМЕНЯЕТСЯ, а не снимается (#628)', () => {
    // Порядок сил и роутинг — как в боевом конфиге: complexity:low ведёт на самую слабую
    // («механическую») модель, complexity:high — на сильную.
    const strength = ['haiku', 'sonnet', 'opus', 'fable'];
    const routing = { 'complexity:low': 'haiku', 'complexity:high': 'opus' };
    const base = ['complexity:low', 'area:core', 'backlog'];

    it('слабая метка роутинга заменена сильнейшей, остальные метки на месте', () => {
        expect(
            disputeLabelsFor({
                backlogLabels: base,
                routingLabels: routing,
                modelStrength: strength,
            }),
        ).toEqual(['complexity:high', 'area:core', 'backlog']);
    });

    it('запись { provider, model } читается так же, как строка', () => {
        expect(
            disputeLabelsFor({
                backlogLabels: base,
                routingLabels: {
                    'complexity:low': { provider: 'claude', model: 'haiku' },
                    'complexity:high': { provider: 'openai', model: 'fable' },
                },
                modelStrength: strength,
            }),
        ).toEqual(['complexity:high', 'area:core', 'backlog']);
    });

    it('несколько меток роутинга в базе → остаётся ОДНА сильнейшая, дублей нет', () => {
        expect(
            disputeLabelsFor({
                backlogLabels: ['complexity:low', 'complexity:high', 'area:core'],
                routingLabels: routing,
                modelStrength: strength,
            }),
        ).toEqual(['complexity:high', 'area:core']);
    });

    it('ничья по силе разрешается СТАРШИНСТВОМ меток, как в pickRoute', () => {
        // Боевая форма: complexity:high и complexity:expert ведут на одну модель. Для
        // роутинга разницы нет, а метку читает человек — «сильнейшая» обязана значить
        // одно и то же и здесь, и в pickRoute (перебор по COMPLEXITY_PRIORITY).
        const tie = { 'complexity:high': 'opus', 'complexity:expert': 'opus' };
        expect(
            disputeLabelsFor({
                backlogLabels: ['complexity:low', 'area:core'],
                routingLabels: { 'complexity:low': 'haiku', ...tie },
                modelStrength: strength,
                labelPriority: ['complexity:expert', 'complexity:high', 'complexity:low'],
            }),
        ).toEqual(['complexity:expert', 'area:core']);
    });

    it('старшинство меток не задано — ничья решается порядком конфига, вход не мутируется', () => {
        // Результат обязан быть одинаковым от прогона к прогону: иначе карточки одной
        // фазы получали бы разные метки. Само правило сторожит `toEqual` по литералу ниже —
        // он краснеет от ЛЮБОГО изменения разрешения ничьей.
        //
        // Отдельно проверяется то, чего литерал не видит: функция чистая и вход не портит.
        // Аргументы приходят из живого конфига (`cfg.modelRouting.labels`, `backlogLabels`),
        // и мутация здесь тихо меняла бы роутинг остального прогона. `Object.freeze` ловит
        // это на месте (в strict-режиме модулей запись в замороженное — исключение), сверка
        // копий — на случай перестановки без записи.
        const args = Object.freeze({
            backlogLabels: Object.freeze(['complexity:low', 'area:core']),
            routingLabels: Object.freeze({
                'complexity:low': 'haiku',
                'complexity:high': 'opus',
                'complexity:expert': 'opus',
            }),
            modelStrength: strength,
        });
        const before = structuredClone({
            backlogLabels: args.backlogLabels,
            routingLabels: args.routingLabels,
        });
        expect(disputeLabelsFor(args)).toEqual(['complexity:high', 'area:core']);
        expect({
            backlogLabels: args.backlogLabels,
            routingLabels: args.routingLabels,
        }).toEqual(before);
    });

    it('метка вне порядка старшинства младше перечисленных при равной силе модели', () => {
        expect(
            disputeLabelsFor({
                backlogLabels: ['complexity:low', 'area:core'],
                routingLabels: {
                    'complexity:low': 'haiku',
                    'area:weird': 'opus',
                    'complexity:high': 'opus',
                },
                modelStrength: strength,
                labelPriority: ['complexity:expert', 'complexity:high', 'complexity:low'],
            }),
        ).toEqual(['complexity:high', 'area:core']);
    });

    it('метки роутинга в базе не было — новой не появляется', () => {
        expect(
            disputeLabelsFor({
                backlogLabels: ['area:core', 'backlog'],
                routingLabels: routing,
                modelStrength: strength,
            }),
        ).toEqual(['area:core', 'backlog']);
    });

    // #630: шкала здесь чужая по происхождению — `review.modelStrength` ранжирует модели
    // РЕВЬЮ, а метки роутинга ведут на КОДЕРСКИЕ модели. Совпадают они только пока проект
    // держит в обоих ключах одни и те же claude-имена; кросс-провайдерная запись (#376)
    // ломает совпадение молча, и «сильнейшей» без этого барьера объявлялась бы
    // единственная известная — сплошь и рядом та самая механическая complexity:low.
    it('ЧАСТЬ моделей роутинга вне порядка сил → метка снимается, а не отдаётся известной слабой', () => {
        expect(
            disputeLabelsFor({
                backlogLabels: base,
                routingLabels: {
                    'complexity:low': 'haiku',
                    'complexity:high': { provider: 'kimi', model: 'kimi-k2-thinking' },
                },
                modelStrength: strength,
            }),
        ).toEqual(['area:core', 'backlog']);
    });

    it('запись роутинга без имени модели — тот же fail-closed, а не «слабейшая»', () => {
        expect(
            disputeLabelsFor({
                backlogLabels: base,
                routingLabels: {
                    'complexity:low': 'haiku',
                    'complexity:high': { provider: 'kimi' },
                },
                modelStrength: strength,
            }),
        ).toEqual(['area:core', 'backlog']);
    });

    it('роутинг ведёт на модели вне порядка сил → метка снимается (назвать сильнейшую нечем)', () => {
        // Деградация к прежнему поведению: карточка достаётся modelRouting.default.
        // Ставить «любую» нельзя — с равной вероятностью это была бы механическая модель.
        expect(
            disputeLabelsFor({
                backlogLabels: base,
                routingLabels: { 'complexity:low': 'чужая-модель' },
                modelStrength: strength,
            }),
        ).toEqual(['area:core', 'backlog']);
    });

    it('роутинга нет вовсе / база пуста — не падает и ничего не выдумывает', () => {
        expect(
            disputeLabelsFor({ backlogLabels: base, routingLabels: {}, modelStrength: strength }),
        ).toEqual(base);
        expect(
            disputeLabelsFor({
                backlogLabels: [],
                routingLabels: routing,
                modelStrength: strength,
            }),
        ).toEqual([]);
    });
});
