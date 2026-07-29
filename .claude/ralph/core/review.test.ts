// Юнит-тесты модуля ревью (#363). Основная часть проверяет САМУ фабрику
// createReviewModule — что она собирает рабочие функции из синтетического env,
// независимо от ralph.js: контракт extraction'а — модуль самодостаточен и переносим
// (цель фазы 3), а не «работает только пока его зовёт ralph.js».
//
// В конце файла — блоки, перенесённые из ralph.test.js при её разнесении по модулям
// (#366): они ходят через боевую поверхность ralph.js и покрывают сценарии, которых
// фабричные тесты не видят.
//
// matchRiskPaths/phaseDiffFiles инжектируются заглушками: pickReviewModel лишь ДЕЛЕГИРУЕТ
// им сопоставление зоны риска и сбор диффа, поэтому здесь тестируется его проводка
// (эскалирует, когда matchRiskPaths вернул хит), а не сам глоб-матчинг — тот покрыт своим
// describe в orchestrator.test.js.
import { describe, it, expect, vi } from 'vitest';
import type { ReviewEnv } from './review.ts';
import { createReviewModule } from './review.ts';
import { shq } from '../shared/ralph-util.ts';
// @ts-expect-error — JS-entry раннера без деклараций типов; блоки в конце файла
// перенесены из ralph.test.js как есть и ходят через его ре-экспорт (#366).
import ralph from '../ralph.js';

// Синтетический env: побочки (ghJson/sh/shArgv/fail) по умолчанию громко падают, если
// функция под тестом дёрнет их без явного override — забытый override становится ошибкой
// теста, а не тихим проходом через боевой gh/shell. Чистые коллабораторы (shq,
// isPlainObject, matchRiskPaths, phaseDiffFiles, log, getConfig) — рабочие заглушки.
function makeEnv(over: Partial<ReviewEnv> = {}): ReviewEnv {
    return {
        getConfig: () => ({}),
        ghJson: () => {
            throw new Error('ghJson не подменён в тесте');
        },
        sh: () => {
            throw new Error('sh не подменён в тесте');
        },
        shArgv: () => {
            throw new Error('shArgv не подменён в тесте');
        },
        shq,
        log: () => {},
        fail: (m: string) => {
            throw new Error(`fail не подменён в тесте: ${m}`);
        },
        isPlainObject: (v: unknown): v is Record<string, unknown> =>
            v !== null && typeof v === 'object' && !Array.isArray(v),
        matchRiskPaths: () => null,
        phaseDiffFiles: () => [],
        ...over,
    };
}

const CFG = {
    review: {
        default: 'claude-opus-4-8',
        escalated: 'claude-fable-5',
        escalateOn: [],
        escalateOnPaths: ['.github/workflows/**', '.claude/ralph/**'],
    },
};

describe('pickReviewModel — эскалация ревью (#130)', () => {
    it('дифф вне зон риска — ревьюит дефолтная модель', () => {
        const { pickReviewModel } = createReviewModule(makeEnv({ matchRiskPaths: () => null }));
        const model = pickReviewModel('Фаза X', 'feature/x', {
            cfg: CFG,
            files: ['src/app/page.tsx', 'README.md'],
        });
        expect(model).toBe('claude-opus-4-8');
    });

    it('дифф трогает зону риска — эскалация на дорогую модель', () => {
        const { pickReviewModel } = createReviewModule(
            makeEnv({ matchRiskPaths: () => '.github/workflows/deploy.yml' }),
        );
        const model = pickReviewModel('Фаза X', 'feature/x', {
            cfg: CFG,
            files: ['.github/workflows/deploy.yml'],
        });
        expect(model).toBe('claude-fable-5');
    });

    it('метка сложности сама по себе больше НЕ эскалирует (escalateOn пуст)', () => {
        // Ровно та регрессия, ради которой заведён #130: complexity:expert описывает
        // трудность написания, а не цену ошибки. escalateOn пуст → gh issue list вовсе не
        // зовётся, метки не смотрятся.
        const ghJson = vi.fn(() => [{ labels: [{ name: 'complexity:expert' }] }]);
        const { pickReviewModel } = createReviewModule(
            makeEnv({ ghJson, matchRiskPaths: () => null }),
        );
        const model = pickReviewModel('Фаза X', 'feature/x', {
            cfg: CFG,
            files: ['src/app/page.tsx'],
        });
        expect(model).toBe('claude-opus-4-8');
        expect(ghJson).not.toHaveBeenCalled();
    });

    it('escalateOn всё ещё работает, если его осознанно заполнили', () => {
        const cfg = { review: { ...CFG.review, escalateOn: ['complexity:expert'] } };
        const { pickReviewModel } = createReviewModule(
            makeEnv({ ghJson: () => [{ labels: [{ name: 'complexity:expert' }] }] }),
        );
        const model = pickReviewModel('Фаза X', 'feature/x', { cfg, files: ['src/app/page.tsx'] });
        expect(model).toBe('claude-fable-5');
    });

    it('сбой gh при получении labels не роняет выбор — ревью дефолтной моделью + предупреждение', () => {
        const cfg = { review: { ...CFG.review, escalateOn: ['complexity:expert'] } };
        const logs: string[] = [];
        const { pickReviewModel } = createReviewModule(
            makeEnv({
                log: (m) => logs.push(m),
                ghJson: () => {
                    throw new Error('gh API error');
                },
                matchRiskPaths: () => null,
            }),
        );
        const model = pickReviewModel('Фаза X', 'feature/x', { cfg, files: ['src/app/page.tsx'] });
        expect(model).toBe('claude-opus-4-8');
        expect(logs.join('\n')).toMatch(/labels/i);
    });

    it('зона риска, но review.escalated не задан — деградация на default + предупреждение', () => {
        // Находка ревью PR #132: эскалация без escalated-модели вернула бы undefined, и
        // runLoop пропустил бы ревью ЦЕЛИКОМ. Деградируем на default.
        const cfg = { review: { default: 'claude-opus-4-8', escalateOnPaths: ['.claude/**'] } };
        const logs: string[] = [];
        const { pickReviewModel } = createReviewModule(
            makeEnv({ log: (m) => logs.push(m), matchRiskPaths: () => '.claude/ralph/ralph.js' }),
        );
        const model = pickReviewModel('Фаза X', 'feature/x', {
            cfg,
            files: ['.claude/ralph/ralph.js'],
        });
        expect(model).toBe('claude-opus-4-8');
        expect(logs.join('\n')).toMatch(/escalated не задан/i);
    });

    it('легаси-конфиг без блока review — прежнее поле reviewModel', () => {
        const { pickReviewModel } = createReviewModule(makeEnv());
        expect(pickReviewModel('Фаза X', 'feature/x', { cfg: { reviewModel: 'none' } })).toBe(
            'none',
        );
    });

    it('files переданы извне — phaseDiffFiles не зовётся (дифф собран один раз, #135)', () => {
        const phaseDiffFiles = vi.fn(() => ['ignored']);
        const { pickReviewModel } = createReviewModule(
            makeEnv({ phaseDiffFiles, matchRiskPaths: () => null }),
        );
        pickReviewModel('Фаза X', 'feature/x', { cfg: CFG, files: ['src/app/page.tsx'] });
        expect(phaseDiffFiles).not.toHaveBeenCalled();
    });

    it('files НЕ переданы — phaseDiffFiles зовётся для сбора диффа', () => {
        const phaseDiffFiles = vi.fn(() => ['.github/workflows/deploy.yml']);
        const matchRiskPaths = vi.fn(() => '.github/workflows/deploy.yml');
        const { pickReviewModel } = createReviewModule(makeEnv({ phaseDiffFiles, matchRiskPaths }));
        const model = pickReviewModel('Фаза X', 'feature/x', { cfg: CFG });
        expect(phaseDiffFiles).toHaveBeenCalledWith('feature/x', expect.any(Object));
        expect(matchRiskPaths).toHaveBeenCalledWith(
            ['.github/workflows/deploy.yml'],
            CFG.review.escalateOnPaths,
        );
        expect(model).toBe('claude-fable-5');
    });

    it('cfg по умолчанию берётся из getConfig (живой config раннера)', () => {
        // getConfig, а не снимок: config заполняется в main() ПОСЛЕ сборки фабрики.
        const { pickReviewModel } = createReviewModule(
            makeEnv({ getConfig: () => CFG, matchRiskPaths: () => null }),
        );
        expect(pickReviewModel('Фаза X', 'feature/x', { files: ['README.md'] })).toBe(
            'claude-opus-4-8',
        );
    });
});

describe('pickReviewFallbackModel — фолбэк ревью, дефолт review.default (#221)', () => {
    const build = (over: Partial<ReviewEnv> = {}) =>
        createReviewModule(makeEnv(over)).pickReviewFallbackModel;

    it('review.fallback задан — возвращается как есть', () => {
        const cfg = { review: { default: 'claude-opus-4-8', fallback: 'claude-fable-5' } };
        expect(build()(cfg)).toBe('claude-fable-5');
    });

    it('review.fallback не задан — дефолт на review.default (не остаётся без фолбэка)', () => {
        expect(build()({ review: { default: 'claude-opus-4-8' } })).toBe('claude-opus-4-8');
    });

    it('review.fallback = "none" — осознанный отказ, вернёт строку "none" (не null)', () => {
        const cfg = { review: { default: 'claude-opus-4-8', fallback: 'none' } };
        expect(build()(cfg)).toBe('none');
    });

    it('блока review нет вовсе — null', () => {
        expect(build()({})).toBe(null);
    });

    it('review — не объект (легаси reviewModel) — null, а не исключение', () => {
        expect(build()({ reviewModel: 'claude-opus-4-8' })).toBe(null);
    });

    it('cfg по умолчанию берётся из getConfig', () => {
        const fb = build({ getConfig: () => ({ review: { default: 'claude-opus-4-8' } }) });
        expect(fb()).toBe('claude-opus-4-8');
    });
});

describe('reviewModelRank — ранг силы модели (#217)', () => {
    const { reviewModelRank } = createReviewModule(makeEnv());

    it('известные модели упорядочены haiku < sonnet < opus < fable', () => {
        expect(reviewModelRank('claude-haiku-4-5-20251001')).toBeLessThan(
            reviewModelRank('claude-sonnet-5'),
        );
        expect(reviewModelRank('claude-sonnet-5')).toBeLessThan(reviewModelRank('claude-opus-4-8'));
        expect(reviewModelRank('claude-opus-4-8')).toBeLessThan(reviewModelRank('claude-fable-5'));
    });

    it('неизвестная/пустая модель → -1 (слабее любой известной)', () => {
        expect(reviewModelRank('claude-mystery')).toBe(-1);
        expect(reviewModelRank(undefined)).toBe(-1);
        expect(reviewModelRank(null)).toBe(-1);
    });
});

describe('strongerReviewModel — поднять планку до сильнейшей (#217)', () => {
    const { strongerReviewModel } = createReviewModule(makeEnv());

    it('возвращает сильнейшую из двух известных', () => {
        expect(strongerReviewModel('claude-opus-4-8', 'claude-fable-5')).toBe('claude-fable-5');
        expect(strongerReviewModel('claude-fable-5', 'claude-opus-4-8')).toBe('claude-fable-5');
    });

    it('null / undefined / "none" у аргумента игнорируется — берётся вторая', () => {
        expect(strongerReviewModel(null, 'claude-opus-4-8')).toBe('claude-opus-4-8');
        expect(strongerReviewModel('claude-opus-4-8', undefined)).toBe('claude-opus-4-8');
        expect(strongerReviewModel('none', 'claude-sonnet-5')).toBe('claude-sonnet-5');
    });

    it('обе пусты → null', () => {
        expect(strongerReviewModel(null, undefined)).toBe(null);
        expect(strongerReviewModel('none', 'none')).toBe(null);
    });

    it('известная всегда побеждает неизвестную (rank -1)', () => {
        expect(strongerReviewModel('claude-mystery', 'claude-haiku-4-5-20251001')).toBe(
            'claude-haiku-4-5-20251001',
        );
    });
});

describe('assertKnownReviewModels — fail-closed планка моделей ревью на старте (#221/#223)', () => {
    const boom = (m: string) => {
        throw new Error(m);
    };

    it('все модели известны и фолбэк не слабее default → true', () => {
        const { assertKnownReviewModels } = createReviewModule(makeEnv());
        const cfg = {
            review: {
                default: 'claude-opus-4-8',
                escalated: 'claude-fable-5',
                fallback: 'claude-opus-4-8',
            },
        };
        expect(assertKnownReviewModels(cfg, 'prod', boom)).toBe(true);
    });

    it('review не задан — планке нечего проверять, true', () => {
        const { assertKnownReviewModels } = createReviewModule(makeEnv());
        expect(assertKnownReviewModels({}, 'playground', boom)).toBe(true);
    });

    it('незнакомая модель в review.default → стоп (barrier #223)', () => {
        const { assertKnownReviewModels } = createReviewModule(makeEnv());
        expect(() =>
            assertKnownReviewModels({ review: { default: 'claude-mystery' } }, 'prod', boom),
        ).toThrow(/review\.default.*claude-mystery.*REVIEW_MODEL_STRENGTH/s);
    });

    it('незнакомая модель в review.fallback → стоп (тот же класс дрейфа)', () => {
        const { assertKnownReviewModels } = createReviewModule(makeEnv());
        expect(() =>
            assertKnownReviewModels(
                { review: { default: 'claude-opus-4-8', fallback: 'claude-mystery' } },
                'prod',
                boom,
            ),
        ).toThrow(/review\.fallback.*claude-mystery.*REVIEW_MODEL_STRENGTH/s);
    });

    it('review.fallback слабее review.default → стоп (#221, не тихая деградация)', () => {
        const { assertKnownReviewModels } = createReviewModule(makeEnv());
        expect(() =>
            assertKnownReviewModels(
                { review: { default: 'claude-opus-4-8', fallback: 'claude-haiku-4-5-20251001' } },
                'prod',
                boom,
            ),
        ).toThrow(/review\.fallback.*claude-haiku-4-5-20251001.*слабее.*review\.default/s);
    });

    it('review.fallback = "none" — осознанный отказ, планку не валит', () => {
        const { assertKnownReviewModels } = createReviewModule(makeEnv());
        const cfg = { review: { default: 'claude-opus-4-8', fallback: 'none' } };
        expect(assertKnownReviewModels(cfg, 'prod', boom)).toBe(true);
    });

    it('фолбэк той же силы, что default — принимается', () => {
        const { assertKnownReviewModels } = createReviewModule(makeEnv());
        const cfg = { review: { default: 'claude-opus-4-8', fallback: 'claude-fable-5' } };
        expect(assertKnownReviewModels(cfg, 'prod', boom)).toBe(true);
    });
});

describe('recordReviewFindings — best-effort вызов журнала находок (#169)', () => {
    it('валидный PR → зовёт журнал с номером, milestone и доверенными авторами', () => {
        const shArgv = vi.fn(() => 'ok');
        const { recordReviewFindings } = createReviewModule(makeEnv({ shArgv }));
        recordReviewFindings({ milestone: 'M1' }, 42, ['alice', 'bob']);
        expect(shArgv).toHaveBeenCalledWith('node', [
            'scripts/review-findings-journal.mjs',
            '42',
            'M1',
            'alice',
            'bob',
        ]);
    });

    it('authorAllowlist фильтрует пустые/нестроковые значения (#237)', () => {
        const shArgv = vi.fn((_file: string, _args: string[]) => 'ok');
        const { recordReviewFindings } = createReviewModule(makeEnv({ shArgv }));
        recordReviewFindings({ milestone: 'M1' }, 7, ['alice', '', '  ', 123, null] as unknown[]);
        expect(shArgv.mock.calls[0][1]).toEqual([
            'scripts/review-findings-journal.mjs',
            '7',
            'M1',
            'alice',
        ]);
    });

    it('номер PR неизвестен (0 / не целое) → запись пропущена, журнал не зовётся', () => {
        const shArgv = vi.fn(() => 'ok');
        const logs: string[] = [];
        const { recordReviewFindings } = createReviewModule(
            makeEnv({ shArgv, log: (m) => logs.push(m) }),
        );
        recordReviewFindings({ milestone: 'M1' }, 0);
        recordReviewFindings({ milestone: 'M1' }, 1.5);
        expect(shArgv).not.toHaveBeenCalled();
        expect(logs.join('\n')).toMatch(/номер PR неизвестен/i);
    });

    it('сбой журнала не бросает — косметика наблюдаемости не роняет смердженную фазу', () => {
        const logs: string[] = [];
        const { recordReviewFindings } = createReviewModule(
            makeEnv({
                shArgv: () => {
                    throw new Error('journal write failed');
                },
                log: (m) => logs.push(m),
            }),
        );
        expect(() => recordReviewFindings({ milestone: 'M1' }, 42)).not.toThrow();
        expect(logs.join('\n')).toMatch(/не смог записать находки/i);
    });
});

describe('pickReviewModel — отсутствующая escalated-модель не отменяет ревью (#132)', () => {
    const { pickReviewModel } = ralph;

    // undefined из эскалации runLoop трактует как «ревью за супервизором» и
    // пропускает ревью ЦЕЛИКОМ — fail-open ровно на самых опасных фазах.
    it('зона риска при незаданном review.escalated — ревью дефолтной моделью, не undefined', () => {
        const logs: string[] = [];
        const model = pickReviewModel('Фаза X', 'feature/x', {
            cfg: {
                review: {
                    default: 'claude-opus-4-8',
                    escalateOnPaths: ['.github/workflows/**'],
                },
            },
            logFn: (m: string) => logs.push(m),
            shFn: () => '.github/workflows/deploy.yml',
            runArgvFn: () => '',
            ghJsonFn: () => [],
        });
        expect(model).toBe('claude-opus-4-8');
        expect(model).toBeDefined();
        expect(logs.join('\n')).toMatch(/escalated/i);
    });

    it('escalateOn строкой вместо массива не роняет выбор модели', () => {
        expect(() =>
            pickReviewModel('Фаза X', 'feature/x', {
                cfg: {
                    review: {
                        default: 'claude-opus-4-8',
                        escalated: 'claude-fable-5',
                        escalateOn: 'complexity:expert',
                    },
                },
                logFn: () => {},
                shFn: () => '',
                runArgvFn: () => '',
                ghJsonFn: () => [],
            }),
        ).not.toThrow();
    });
});

// #366: сценарии pickReviewModel, которые фабричные тесты выше не видят, — устойчивость
// к сбою сбора диффа и anti-injection по имени ветки (инвариант C3/7). Перенесены из
// ralph.test.js вместе со своими фикстурами (CFG/deps), ходят через ре-экспорт ralph.js.
describe('pickReviewModel — сбой диффа и небезопасная ветка (#130)', () => {
    const { pickReviewModel } = ralph;

    const CFG = {
        review: {
            default: 'claude-opus-4-8',
            escalated: 'claude-fable-5',
            escalateOn: [],
            escalateOnPaths: ['.github/workflows/**', '.claude/ralph/**'],
        },
    };
    const deps = (over = {}) => ({
        cfg: CFG,
        logFn: () => {},
        ghJsonFn: () => [],
        shFn: () => '',
        // #252: fetch внутри phaseDiffFiles теперь мутация через argv.
        runArgvFn: () => '',
        ...over,
    });

    it('сбой git при получении диффа не роняет сдачу — ревью дефолтной моделью', () => {
        const logs: string[] = [];
        const model = pickReviewModel(
            'Фаза X',
            'feature/x',
            deps({
                logFn: (m: string) => logs.push(m),
                shFn: () => {
                    throw new Error('fatal: no upstream');
                },
            }),
        );
        expect(model).toBe('claude-opus-4-8');
        expect(logs.join('\n')).toMatch(/дифф/i);
    });

    it('имя ветки со спецсимволами шелла не уходит в git — эскалации нет, есть предупреждение', () => {
        // sh() исполняет СТРОКУ через шелл, поэтому ветка из конфига обязана быть
        // провалидирована до подстановки: `$(...)`/`;` внутри имени иначе исполнятся.
        const shCmds: string[] = [];
        const logs: string[] = [];
        const model = pickReviewModel(
            'Фаза X',
            'feature/x;$(id)',
            deps({
                logFn: (m: string) => logs.push(m),
                shFn: (cmd: string) => {
                    shCmds.push(cmd);
                    return '.github/workflows/deploy.yml';
                },
            }),
        );
        expect(shCmds).toEqual([]);
        expect(model).toBe('claude-opus-4-8');
        expect(logs.join('\n')).toMatch(/ветк/i);
    });
});
