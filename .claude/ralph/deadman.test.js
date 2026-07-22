// Юнит-тесты deadman.js (#147) — чистое правило «какой порог тишины применять».
// Модуль без побочек (только строки/числа на вход-выход), поэтому DI/guardSideEffect
// не нужны: реального лога, сети и файлов здесь нет, только классификация хвоста и
// арифметика порога.
import { describe, it, expect } from 'vitest';
import {
    classifyActivity,
    silenceThresholdMs,
    thresholdForTail,
    parseApiWaitMs,
    DEFAULT_DEADMAN,
} from './deadman.js';

// Строки лога как их пишет log() в ralph.js — с ISO-таймстампом и маркером.
const t = (msg) => `[2026-07-22T06:30:07.015Z] ${msg}`;

describe('classifyActivity — режим петли по хвосту лога', () => {
    it('claude-сессия в работе (▶ claude -p последней строкой) → coder', () => {
        const lines = [
            t('🔄 Фаза X | итерация 1/10 | Issue #1: ... | модель: claude-opus-4-8 | осталось: 3'),
            t('▶ claude -p "Прочитай …" --max-turns 200 --model claude-opus-4-8'),
        ];
        expect(classifyActivity(lines)).toBe('coder');
    });

    it('маркер итерации 🔄 без последующего ▶ (мгновение между строками) → coder', () => {
        expect(classifyActivity([t('🔄 Фаза X | итерация 2/10 | Issue #2')])).toBe('coder');
    });

    it('ревью и правки — тоже claude-сессии → coder', () => {
        expect(classifyActivity([t('🔍 Ревью фазы моделью: claude-fable-5')])).toBe('coder');
        expect(classifyActivity([t('🔧 Правки по ревью...')])).toBe('coder');
    });

    it('старт гейта 🚦 → gate', () => {
        expect(
            classifyActivity([t('🚦 Гейт мерджа: проверка label blocked + сверка HEAD + чеки...')]),
        ).toBe('gate');
    });

    it('идёт прогон чеков (последняя строка — ✓ пройденного чека) → gate', () => {
        const lines = [t('🚦 Гейт мерджа: ...'), t('  ✓ build'), t('  ✓ lint'), t('  ✓ typecheck')];
        expect(classifyActivity(lines)).toBe('gate');
    });

    it('красный чек (✗) — всё ещё режим гейта → gate', () => {
        expect(classifyActivity([t('  ✗ test — красный, авто-мердж отменён')])).toBe('gate');
    });

    it('хозяйственные шаги (git/gh) без маркеров сессии/гейта → default', () => {
        const lines = [
            t('🌳 Worktree раннера переведён на свежий origin/main.'),
            t('📦 npm ci перед чеками...'),
        ];
        // 🌳/📦 — не маркеры claude-сессии и не гейт: короткий дефолт.
        expect(classifyActivity(lines)).toBe('default');
    });

    it('пустой хвост → default', () => {
        expect(classifyActivity([])).toBe('default');
    });

    it('нейтральная строка (⚠, многострочный хвост ошибки) ПОСЛЕ ▶ claude не сбивает режим → coder', () => {
        // Реальный кейс из ralph.log: посреди сессии проскочило ⚠ о выборе ревью-
        // модели. Классификатор должен пропустить нейтральную строку и остаться в
        // coder, иначе короткий порог дал бы ложный ночной пуш на легитимной сессии.
        const lines = [
            t('▶ claude -p "…" --max-turns 200 --model claude-opus-4-8'),
            t('⚠ Не смог получить дифф фазы для выбора ревью-модели: ...'),
            "fatal: couldn't find remote ref feature/x",
        ];
        expect(classifyActivity(lines)).toBe('coder');
    });

    it('после мерджа (✅ PR смерджен) режим гейта закрыт → default', () => {
        // ✓-строки чеков остаются в хвосте выше, но ✅ PR как более свежий major-маркер
        // должен закрыть режим гейта — иначе после мерджа висел бы длинный gate-порог.
        const lines = [
            t('  ✓ test'),
            t('✅ PR #143 смерджен (squash), дерево раннера на свежем origin/main.'),
        ];
        expect(classifyActivity(lines)).toBe('default');
    });

    it('создание PR после ✅ Фаза — это claude-сессия (▶ claude) → coder', () => {
        const lines = [
            t('✅ Фаза "X" — issues закрыты. PR → ревью → правки → гейт мерджа...'),
            t('▶ claude -p "…" --max-turns 200'),
        ];
        expect(classifyActivity(lines)).toBe('coder');
    });

    it('пауза API-лимита (🔔 PUSH ⏳ Жду N мин) поверх ▶ claude → apiwait, а НЕ coder', () => {
        // runClaude синхронно спит N минут на этой строке; без отдельного режима скан ушёл
        // бы назад к ▶ claude, взял бы coder-порог (2ч10м) и дал ложный пуш на паузе >2ч.
        const lines = [
            t('▶ claude -p "…" --max-turns 200 --model claude-opus-4-8'),
            t(
                '🔔 PUSH: ⏳ Ralph: API-лимит — сессия упала с маркером лимита. Жду 305 мин до сброса окна и повторяю (попытка 1/3).',
            ),
        ];
        expect(classifyActivity(lines)).toBe('apiwait');
    });

    it('после сна API-лимита новая сессия (▶ claude свежее паузы) → снова coder', () => {
        const lines = [
            t('🔔 PUSH: ⏳ Ralph: API-лимит — … Жду 305 мин … (попытка 1/3).'),
            t('▶ claude -p "…" --max-turns 200 --model claude-opus-4-8'),
        ];
        expect(classifyActivity(lines)).toBe('coder');
    });
});

describe('parseApiWaitMs — порог паузы из строки «Жду N мин»', () => {
    const cfg = {
        claudeTimeoutMs: 7200000,
        deadman: { iterationGraceMs: 600000, gateSilenceMs: 600000, defaultSilenceMs: 300000 },
    };

    it('вынимает N минут и добавляет запас iterationGraceMs', () => {
        const lines = [t('🔔 PUSH: ⏳ Ralph: API-лимит — … Жду 305 мин … (попытка 1/3).')];
        expect(parseApiWaitMs(lines, cfg)).toBe(305 * 60000 + 600000);
    });

    it('нет строки паузы в хвосте → null (вызывающий возьмёт консервативный порог)', () => {
        expect(parseApiWaitMs([t('▶ claude -p "…"')], cfg)).toBeNull();
    });
});

describe('silenceThresholdMs — порог по режиму и конфигу', () => {
    const cfg = {
        claudeTimeoutMs: 7200000,
        deadman: {
            iterationGraceMs: 600000,
            gateSilenceMs: 600000,
            defaultSilenceMs: 300000,
        },
    };

    it('coder → claudeTimeoutMs + запас (кодер-сессия легитимно молчит до таймаута)', () => {
        expect(silenceThresholdMs('coder', cfg)).toBe(7200000 + 600000);
    });

    it('gate → порог тишины гейта (таймаут самого долгого чека + запас)', () => {
        expect(silenceThresholdMs('gate', cfg)).toBe(600000);
    });

    it('default → короткий дефолт для git/gh-шагов', () => {
        expect(silenceThresholdMs('default', cfg)).toBe(300000);
    });

    it('нет блока deadman в конфиге → берутся DEFAULT_DEADMAN', () => {
        const bare = { claudeTimeoutMs: 7200000 };
        expect(silenceThresholdMs('coder', bare)).toBe(7200000 + DEFAULT_DEADMAN.iterationGraceMs);
        expect(silenceThresholdMs('gate', bare)).toBe(DEFAULT_DEADMAN.gateSilenceMs);
        expect(silenceThresholdMs('default', bare)).toBe(DEFAULT_DEADMAN.defaultSilenceMs);
    });

    it('нет claudeTimeoutMs → дефолт 2ч (как в runClaudeOnce)', () => {
        expect(silenceThresholdMs('coder', { deadman: { iterationGraceMs: 0 } })).toBe(
            2 * 60 * 60 * 1000,
        );
    });

    it('сырой конфиг с секцией common (до резолва) НЕ читается — берутся дефолты', () => {
        // Контракт узкий: подаётся только резолвнутый профилем конфиг (поля на верхнем
        // уровне). Сырой { common } без имени профиля честно слить нельзя, поэтому его
        // оверрайды игнорируются и берётся DEFAULT_DEADMAN — и раннер, и монитор резолвят
        // профиль ДО вызова детекта, так что в бою это недостижимо.
        const raw = {
            common: { claudeTimeoutMs: 7200000, deadman: { gateSilenceMs: 111 } },
        };
        expect(silenceThresholdMs('gate', raw)).toBe(DEFAULT_DEADMAN.gateSilenceMs);
    });

    it('неизвестный режим трактуется как default (fail-safe)', () => {
        expect(silenceThresholdMs('что-то', cfg)).toBe(300000);
    });

    it('apiwait → N мин из строки паузы + запас (lines прокинуты)', () => {
        const lines = [t('🔔 PUSH: ⏳ Ralph: API-лимит — … Жду 90 мин … (попытка 1/3).')];
        expect(silenceThresholdMs('apiwait', cfg, lines)).toBe(90 * 60000 + 600000);
    });

    it('apiwait без строки паузы (lines пустые) → консервативно coder-порог', () => {
        expect(silenceThresholdMs('apiwait', cfg, [])).toBe(7200000 + 600000);
    });
});

describe('thresholdForTail — хвост лога → порог', () => {
    const cfg = {
        claudeTimeoutMs: 7200000,
        deadman: { iterationGraceMs: 600000, gateSilenceMs: 600000, defaultSilenceMs: 300000 },
    };

    it('хвост кодер-сессии → длинный порог', () => {
        expect(thresholdForTail([t('▶ claude -p "…"')], cfg)).toBe(7800000);
    });

    it('хвост гейта → порог гейта', () => {
        expect(thresholdForTail([t('  ✓ build')], cfg)).toBe(600000);
    });

    it('хозяйственный хвост → короткий дефолт', () => {
        expect(thresholdForTail([t('🌳 Worktree раннера ...')], cfg)).toBe(300000);
    });

    it('хвост с паузой API-лимита → порог самой паузы (N мин + запас), а не coder', () => {
        const lines = [
            t('▶ claude -p "…"'),
            t('🔔 PUSH: ⏳ Ralph: API-лимит — … Жду 45 мин … (попытка 1/3).'),
        ];
        expect(thresholdForTail(lines, cfg)).toBe(45 * 60000 + 600000);
    });
});
