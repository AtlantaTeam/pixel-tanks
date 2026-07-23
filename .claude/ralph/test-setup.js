// #138: общий предохранитель для ВСЕХ тестов проекта "ralph" (vitest.config.ts →
// setupFiles). Раньше жил в ralph.test.js, но include проекта покрывает и
// scripts/**, и будущие файлы рядом с раннером — а они получали бы только throw из
// боевого дефолта, без ловли вызова, проглоченного try/catch (ревью PR #141).
//
// Механика: ralph.js под RALPH_NO_SIDE_EFFECTS=1 не исполняет побочку (шелл, запись
// state, npm ci, спавн claude), а записывает попытку в журнал. Половина вызовов
// обёрнута в try/catch, чтобы одна git-ошибка не роняла ночной прогон, — значит,
// одного исключения для покраснения теста мало, и журнал сверяем отдельно.
//
// telegram-notifier.js (#85) — самостоятельный модуль (не require('./ralph.js'),
// иначе циклическая зависимость с #86), поэтому у него свой журнал попыток. Сверяем
// оба в одном afterEach, а не заводим второй setupFiles — предохранитель один на
// весь проект "ralph".
//
// security-audit.mjs (#239) — третий журнал: savePushedKeys пишет дедуп-стор пуша
// вне git, забытый мок в тесте молча создал бы/перезаписал реальный файл на диске.
import { afterEach, expect } from 'vitest';
import ralph from './ralph.js';
import telegramNotifier from './telegram-notifier.js';
import { sideEffectAttempts as securityAuditSideEffectAttempts } from '../../scripts/security-audit.mjs';

afterEach(() => {
    const attempts = [
        ...ralph.sideEffectAttempts.splice(0),
        ...telegramNotifier.sideEffectAttempts.splice(0),
        ...securityAuditSideEffectAttempts.splice(0),
    ];
    expect(
        attempts,
        `Тест дошёл до боевой побочки: ${attempts.join(' | ')}\n` +
            `Подмени зависимость в deps теста (shFn, saveStateFn, installFn, spawnFn, execFn ` +
            `или коллаборатор, который их зовёт: phaseDiffFilesFn, checksGreenFn, …).`,
    ).toEqual([]);
});
