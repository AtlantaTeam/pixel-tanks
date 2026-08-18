// Модуль детекции и ожидания транзиентной недоступности рантайма (#606, milestone
// «Раннер · Устойчивость к отказам»). Вынесен по тому же приёму, что api-limit.ts (#361):
// чистые преобразования вход→выход, без побочек — сам цикл ожидания/повтора живёт в
// runClaude (orchestrator.ts), здесь — только детект и арифметика паузы.
//
// Инцидент 18.08: Claude Code CLI автообновился прямо во время многочасового AFK-прогона —
// симлинк `/usr/bin/claude` на секунды-минуты остался без бинаря, сессия упала с кодом 127
// и строкой «No such file or directory». Раннер трактовал это как отказ по существу (та же
// ветка, что настоящий крах модели) и вернул label blocked на PR, хотя работа уже была
// готова (чини-сессия починила гейт за 15 минут до того). Петля простояла 2+ часа до
// человека. Класс тот же, что API-лимит (api-limit.ts) и HTTP 503 форжа (#603/#79): работа
// не сделана не потому, что что-то не так с кодом или PR, а потому что инструмент моргнул —
// значит это транзиент, который стоит пережить повтором, а не honest-стоп с первой попытки.
//
// TS-модуль без билд-шага: исполняется нативным type stripping Node 24 (erasable-only
// синтаксис — только аннотации типов, ни enum, ни namespace, ни parameter properties).
// Без побочек вовсе — guardSideEffect здесь не нужен (#138 не при чём), поэтому, как и
// api-limit.ts/ralph-util.ts, это набор standalone-экспортов, а не фабрика с DI.

import { positiveIntOrDefault } from '../shared/ralph-util.ts';

// Узкая детекция НАМЕРЕННО: код 127 (shell «command not found» — ровно то, что даёт
// упавший на пересоздании симлинк `/usr/bin/claude`) либо явные ENOENT-формулировки в
// выводе. Ненулевой код с осмысленным выводом модели (обычное падение сессии) под этот
// паттерн не подходит и остаётся прежним fail-closed стопом — разводить два класса именно
// по тексту, а не по самому факту ненулевого кода, того и требует критерий готовности.
export const RUNTIME_UNAVAILABLE_RE = /ENOENT|No such file or directory/i;

export function isRuntimeUnavailable(code: number, output: string): boolean {
    return code === 127 || RUNTIME_UNAVAILABLE_RE.test(output);
}

// Обновление CLI занимает секунды-минуты (research в теле issue) — 5 минут суммарного
// бюджета повторов с запасом кроют его, не превращая честный крах рантайма в вечный сон.
export const DEFAULT_RUNTIME_UNAVAILABLE_MAX_WAIT_MS = 5 * 60 * 1000;
// База линейного backoff между попытками — тот же приём, что ghJson (exec.ts): попытка N
// ждёт N × базу, растущая пауза не долбит в стену на полной скорости, но и не запирает
// первый повтор надолго, пока обновление ещё может завершиться за секунды.
export const DEFAULT_RUNTIME_UNAVAILABLE_RETRY_DELAY_MS = 10 * 1000;

type RuntimeUnavailableCfg = {
    runtimeUnavailableRetryDelayMs?: number;
};

// Длительность паузы перед попыткой N (1-индексация, как у ghJson). Вызывающий сам
// обрезает результат остатком бюджета (runtimeUnavailableMaxWaitMs) — эта функция бюджета
// не знает и не обязана.
export function runtimeUnavailableWaitMs(attempt: number, cfg: RuntimeUnavailableCfg = {}): number {
    const base = positiveIntOrDefault(
        cfg.runtimeUnavailableRetryDelayMs,
        DEFAULT_RUNTIME_UNAVAILABLE_RETRY_DELAY_MS,
    );
    return base * attempt;
}

// Текст промежуточного повтора (в лог, не в пуш — короткие паузы не должны спамить
// человека; пуш зовётся один раз, на честном исчерпании бюджета, см. ниже).
export function runtimeUnavailableMessage(attempt: number, waitMs: number, code: number): string {
    return (
        `⚠ Рантайм недоступен (код ${code}) — похоже, CLI обновляется. ` +
        `Повтор через ${Math.round(waitMs / 1000)}с (попытка ${attempt}).`
    );
}

// Текст честного исчерпания бюджета — ЕДИНСТВЕННЫЙ источник правды формулировки причины.
// Явно называет её «рантайм недоступен», а не «вердикта не было»/«сессия упала»: критерий
// готовности #606 требует, чтобы пуш не путал транзиентную помеху с отказом по существу.
export function runtimeUnavailableExhaustedMessage(maxWaitMs: number, attempts: number): string {
    return (
        `⛔ Ralph: рантайм недоступен дольше ${Math.round(maxWaitMs / 60000)} мин ` +
        `(${attempts} повторов) — стоп (fail-closed). Причина — CLI недоступен ` +
        `(обновление/симлинк), а НЕ отказ ревью или сессии по существу.`
    );
}
