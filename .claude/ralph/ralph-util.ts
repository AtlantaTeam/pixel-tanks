// Общий util-модуль без побочек (#232): `shq`/`positiveIntOrDefault`/`sleep` жили в
// копиях в ralph.js и telegram-notifier.js (ревью PR #231) — правка в одной не доезжала
// до другой. Вынесены сюда по тому же приёму, что и guardSideEffect (#145,
// side-effect-guard.ts): общий модуль без cycle на ralph.js, требуется и через
// require() (CommonJS: ralph.js, telegram-notifier.js), и потенциально через import
// (ESM-потребители).
//
// TS-модуль без билд-шага: исполняется нативным type stripping Node 24 (erasable-only
// синтаксис — только аннотации типов, ни enum, ни namespace, ни parameter properties).
// Без побочек вовсе — guardSideEffect здесь не нужен (#138 не при чём: ни один экспорт
// не трогает диск/сеть/процессы).

// #133: sh() в ralph.js исполняет СТРОКУ через /bin/sh — любое значение, попадающее в
// неё (milestone/branch из конфига, номера PR и заголовки issues с публичного GitHub),
// обязано быть заквотировано. Одинарные кавычки в POSIX sh не интерпретируют вообще
// ничего, поэтому достаточно закрыть-экранировать-открыть на каждой одинарной кавычке
// внутри значения: don't → 'don'\''t'.
export function shq(value: unknown): string {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Строго typeof number, без приведения (#132): строка '80' из JSON-конфига — это
// опечатка, а не «странное число», и Number('80') тихо простил бы её вместо дефолта.
// value > 0: 0 — не «без ограничения», а бюджет без единого хода/попытки.
export function positiveIntOrDefault(value: unknown, dflt: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : dflt;
}

// Синхронный sleep: раннер и телеграм-ретраи — синхронный код (execSync-хореография),
// event loop свободен, поэтому Atomics.wait — корректный способ подождать без busy-loop.
export function sleep(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
