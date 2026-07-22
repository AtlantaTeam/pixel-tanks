// Приёмочные (сценарные) тесты deadman (#150) — доказательство критериев готовности
// фазы 1 «тишина как алерт» через ВЕСЬ конвейер детекта end-to-end, а не по кускам.
//
// Юнит-тесты живут рядом: deadman.test.js (#147 — классификация хвоста и порог) и
// monitor.test.js (#148/#149 — evalDeadman/readLogTail/дедуп на замороженных числах).
// Здесь другой уровень: реальный файл лога на диске → readLogTail (реальный fs.stat
// mtime) → evalDeadman → maybePushDeadman → доставка через настоящий pushEvent(), с
// проверкой ровно тех сценариев отказа, что в критериях Issue #150:
//   • kill -STOP сессии → пуш не позднее порога шага; событие видно в логе;
//   • kill -9 раннера → пуш без участия раннера (только файл + чистые функции);
//   • полный живой прогон фазы → ни одного ложного пуша.
//
// Побочки запрещены и здесь (RALPH_NO_SIDE_EFFECTS=1 из vitest.config, guardSideEffect,
// общий afterEach в test-setup.js): сеть/шелл/state не трогаем, доставка пуша — через
// инжектируемый pushFn/logFn (DI), реальный pushEvent зовём в non-prod профиле, где он
// печатает маркер, но НЕ ходит в Telegram (проверяется отдельным assert'ом ниже).
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readLogTail, evalDeadman, maybePushDeadman } from './monitor.js';
import ralph, { pushEvent as pushEventReal } from './ralph.js';

// Строка лога как её пишет log() в ralph.js — ISO-таймстамп + маркер.
const t = (msg) => `[2026-07-22T06:30:07.015Z] ${msg}`;
const MIN = 60000;

// Резолвнутый профилем конфиг (пороги на верхнем уровне): coder = claudeTimeoutMs +
// iterationGraceMs = 2ч10м, gate = 10м, default = 5м. profileName != 'prod' — pushEvent
// печатает маркер, но не доставляет в сеть (см. pushEvent в ralph.js).
const CFG = {
    profileName: 'playground',
    claudeTimeoutMs: 7200000,
    deadman: { iterationGraceMs: 600000, gateSilenceMs: 600000, defaultSilenceMs: 300000 },
};
const CODER_THRESHOLD = 7200000 + 600000; // 2ч10м
const GATE_THRESHOLD = 600000; // 10м
const DEFAULT_THRESHOLD = 300000; // 5м

// ── Реальный временный лог на диске (как боевой ralph.log) ────────────────────────
const tmpFiles = [];
function writeLog(lines) {
    const p = path.join(os.tmpdir(), `ralph-deadman-scn-${tmpFiles.length}-${lines.length}.log`);
    fs.writeFileSync(p, lines.join('\n'));
    tmpFiles.push(p);
    return p;
}
afterEach(() => {
    while (tmpFiles.length) {
        try {
            fs.unlinkSync(tmpFiles.pop());
        } catch {
            /* ignore */
        }
    }
});

// Один такт монитора над РЕАЛЬНЫМ файлом: читаем хвост и mtime с диска, «сейчас» =
// mtime + ageMs (детерминированно, без гонки с реальными часами), гоняем evalDeadman и
// maybePushDeadman через настоящий pushEvent() с перехваченным logFn. Возвращаем всё,
// что нужно проверить: тихо/нет, режим, был ли доставлен пуш и его текст, новый ключ
// дедупа. Именно этот путь переживает смерть раннера — на входе только файл.
function tick(logPath, ageMs, { prevKey = null, logSpy = vi.fn(), cfg = CFG } = {}) {
    const { lines, lastMtime } = readLogTail(200, logPath);
    const now = lastMtime + ageMs;
    const deadman = evalDeadman({ now, lastMtime, lines, config: cfg });
    const key = maybePushDeadman(deadman, lastMtime, prevKey, {
        cfg,
        milestoneName: 'Наблюдаемость ralph · Фаза 1',
        pushFn: (msg, c, opts) => pushEventReal(msg, c, { ...opts, logFn: logSpy }),
    });
    const pushed = logSpy.mock.calls.filter((c) => /🔔 PUSH/.test(c[0]));
    return { deadman, key, logSpy, pushedText: pushed.map((c) => c[0]) };
}

describe('kill -STOP сессии → пуш не позднее порога coder; событие видно в логе', () => {
    // kill -STOP замораживает ЖИВОЙ процесс сессии: claude -p не пишет, лог стоит на
    // последней строке coder-режима (▶ claude). Порог здесь — самый длинный (2ч10м),
    // потому что легитимная сессия молчит до claudeTimeoutMs.
    const coderTail = [
        t('🔄 Фаза 1 | итерация 1/10 | Issue #150 | модель: claude-opus-4-8'),
        t('▶ claude -p "…" --max-turns 200 --model claude-opus-4-8'),
    ];

    it('молчит В ПРЕДЕЛАХ порога (2ч) → пуша нет (сессия легитимно долгая)', () => {
        const r = tick(writeLog(coderTail), 120 * MIN);
        expect(r.deadman.activity).toBe('coder');
        expect(r.deadman.silent).toBe(false);
        expect(r.pushedText).toEqual([]);
    });

    it('ровно на пороге (2ч10м) → ещё не тишина (граница строго «дольше порога»)', () => {
        const r = tick(writeLog(coderTail), CODER_THRESHOLD);
        expect(r.deadman.silent).toBe(false);
        expect(r.pushedText).toEqual([]);
    });

    it('перешагнул порог → пуш доставлен, в тексте DEADMAN + фаза + режим coder', () => {
        const r = tick(writeLog(coderTail), CODER_THRESHOLD + MIN);
        expect(r.deadman.silent).toBe(true);
        expect(r.deadman.activity).toBe('coder');
        // «Событие видно в логе»: pushEvent напечатал маркер 🔔 PUSH через logFn.
        expect(r.pushedText).toHaveLength(1);
        expect(r.pushedText[0]).toContain('DEADMAN');
        expect(r.pushedText[0]).toContain('Наблюдаемость ralph · Фаза 1');
        expect(r.pushedText[0]).toContain('режим coder');
        // Ключ дедупа = mtime замёрзшего лога: повторный такт той же тишины не пушит.
        expect(r.key).not.toBeNull();
    });
});

describe('kill -9 раннера → пуш без участия раннера (только файл + чистые функции)', () => {
    // Раннер убит (kill -9, OOM): ralph.js больше ничего не пишет, лог замёрз. Монитор
    // detached — жив и считает тишину ПО ФАЙЛУ. Доказательство «без участия раннера»:
    // на входе tick() только путь к файлу; ни одной боевой побочки ralph.js (afterEach
    // в test-setup.js сверяет журнал sideEffectAttempts — он обязан остаться пустым).
    it('раннер мёртв на хоз-шаге дольше дефолта → пуш из одного лишь файла', () => {
        const p = writeLog([t('🔀 Переключение на ветку feature/ralph-deadman')]);
        const r = tick(p, DEFAULT_THRESHOLD + MIN); // мёртв 6 мин > default 5 мин
        expect(r.deadman.activity).toBe('default');
        expect(r.deadman.silent).toBe(true);
        expect(r.pushedText).toHaveLength(1);
        expect(r.pushedText[0]).toContain('DEADMAN');
        // Детект прошёл, а раннер (ralph.js) не сделал ни одной побочки — иначе это был
        // бы не «без участия раннера». Сверяем прямо здесь, не дожидаясь afterEach.
        expect(ralph.sideEffectAttempts).toEqual([]);
    });

    it('раннер мёртв в пределах дефолта → ложного пуша нет', () => {
        const p = writeLog([t('🔀 Переключение на ветку feature/ralph-deadman')]);
        const r = tick(p, 4 * MIN); // 4 мин < 5 мин
        expect(r.deadman.silent).toBe(false);
        expect(r.pushedText).toEqual([]);
    });

    it('раннер убит во время гейта → тишина по gate-порогу, пуш из файла', () => {
        // kill -9 посреди прогона чеков: последняя строка — ✓ пройденного чека.
        const p = writeLog([t('🚦 Гейт мерджа: ...'), t('  ✓ build'), t('  ✓ lint')]);
        const r = tick(p, GATE_THRESHOLD + MIN); // 11 мин > gate 10 мин
        expect(r.deadman.activity).toBe('gate');
        expect(r.deadman.silent).toBe(true);
        expect(r.pushedText).toHaveLength(1);
    });
});

describe('полный живой прогон фазы → ни одного ложного deadman-пуша', () => {
    // Реальная последовательность шагов одной фазы (маркеры взяты из боевого ralph.log):
    // старт → итерация → длинная сессия → ревью → правки → гейт → чеки → мердж → смена
    // ветки → следующая итерация. Каждый шаг молчит В ПРЕДЕЛАХ порога своего режима.
    // Каждый такт — свежий файл (лог растёт, mtime сдвигается), ключ дедупа переносим
    // между тактами, как это делает monitor.js между тиками setInterval.
    const LIVE_PHASE = [
        { tail: [t('🚀 Ralph запущен: профиль playground')], ageMin: 1 }, // default 5м
        { tail: [t('🔄 Фаза 1 | итерация 1/10 | Issue #150')], ageMin: 15 }, // coder 130м
        { tail: [t('▶ claude -p "…" --max-turns 200 --model claude-opus-4-8')], ageMin: 45 },
        { tail: [t('🔍 Ревью фазы моделью: claude-fable-5')], ageMin: 25 }, // coder
        { tail: [t('🔧 Правки по ревью...')], ageMin: 12 }, // coder
        { tail: [t('🚦 Гейт мерджа: проверка label blocked + сверка HEAD...')], ageMin: 3 }, // gate 10м
        { tail: [t('🚦 Гейт мерджа: ...'), t('  ✓ build'), t('  ✓ e2e')], ageMin: 8 }, // gate
        { tail: [t('✅ PR #150 смерджен (squash), дерево на свежем origin/main.')], ageMin: 1 }, // default
        { tail: [t('🔀 Переключение на ветку feature/ralph-deadman')], ageMin: 2 }, // default
        { tail: [t('🔄 Фаза 1 | итерация 2/10 | Issue #151')], ageMin: 9 }, // coder
    ];

    it('прогоняем всю фазу тик за тиком — пушей ноль, ключ дедупа не встаёт', () => {
        const logSpy = vi.fn();
        let key = null;
        for (const step of LIVE_PHASE) {
            const r = tick(writeLog(step.tail), step.ageMin * MIN, { prevKey: key, logSpy });
            expect(r.deadman.silent, `ложная тишина на шаге "${step.tail[0].slice(30, 60)}"`).toBe(
                false,
            );
            key = r.key;
        }
        expect(logSpy.mock.calls.filter((c) => /🔔 PUSH/.test(c[0]))).toEqual([]);
        expect(key).toBeNull(); // ни один такт не выставил ключ дедупа
    });

    it('после живого прогона сессия зависает → ровно ОДИН пуш, повтор дедуплится', () => {
        // Живой прогон закончился зависшей кодер-сессией. Первый такт за порогом — пуш;
        // второй такт той же тишины (тот же mtime) — дедуп, второго пуша нет.
        const logSpy = vi.fn();
        const frozen = writeLog([t('▶ claude -p "…" --max-turns 200 --model claude-opus-4-8')]);
        const first = tick(frozen, CODER_THRESHOLD + 2 * MIN, { logSpy });
        expect(first.deadman.silent).toBe(true);
        const second = tick(frozen, CODER_THRESHOLD + 5 * MIN, { prevKey: first.key, logSpy });
        expect(second.deadman.silent).toBe(true); // всё ещё тихо…
        // …но пуш был ровно один: тот же эпизод (mtime не сдвинулся) не пушится дважды.
        expect(logSpy.mock.calls.filter((c) => /🔔 PUSH/.test(c[0]))).toHaveLength(1);
        expect(second.key).toBe(first.key);
    });
});

describe('побочки в тестах запрещены (критерий #150: RALPH_NO_SIDE_EFFECTS/guardSideEffect/DI)', () => {
    it('окружение теста ralph держит предохранитель включённым', () => {
        expect(process.env.RALPH_NO_SIDE_EFFECTS).toBe('1');
    });

    it('реальный pushEvent в non-prod НЕ уходит в сеть: sendFn не зовётся, вернул false', () => {
        // DI: перехватываем sendFn (транспорт Telegram). В profileName != prod pushEvent
        // возвращает false ДО доставки — сеть недостижима из теста по построению.
        const sendFn = vi.fn();
        const logSpy = vi.fn();
        const delivered = pushEventReal('💀 DEADMAN проверочный', CFG, { sendFn, logFn: logSpy });
        expect(delivered).toBe(false);
        expect(sendFn).not.toHaveBeenCalled();
        expect(logSpy.mock.calls[0][0]).toContain('🔔 PUSH'); // маркер в лог всё равно ушёл
    });
});
