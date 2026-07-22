// Общая тест-обвязка для тестов deadman/monitor (#Ov3). Раньше приватный tmp-каталог,
// writeLog/mkTmp, cleanup в afterEach/afterAll и хелпер t() (ISO-префикс строки лога)
// были продублированы почти дословно в трёх тест-файлах. Здесь — один источник: формат
// строки лога и жизненный цикл временного файла меняются в одном месте.
import fs from 'fs';
import os from 'os';
import path from 'path';

// Строка лога как её пишет log() в ralph.js — ISO-таймстамп + маркер. Таймстамп
// фиксированный: тесты задают «сейчас» через mtime + ageMs, сам префикс роли не играет.
export function logLine(msg) {
    return `[2026-07-22T06:30:07.015Z] ${msg}`;
}

// Фабрика временных лог-файлов на диске (как боевой ralph.log). Приватный каталог через
// mkdtemp: иначе имена в общем os.tmpdir() детерминированы и два параллельных прогона
// vitest (гейт раннера в своём worktree + человек в своём) писали бы и unlink'али одни
// файлы → флак. Возвращает writeLog() (строки или готовый контент) и cleanup-функции для
// afterEach (файлы) и afterAll (каталог).
export function makeTmpLog(prefix) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const tmpFiles = [];
    function writeLog(linesOrContent) {
        const content = Array.isArray(linesOrContent) ? linesOrContent.join('\n') : linesOrContent;
        const p = path.join(tmpDir, `log-${tmpFiles.length}-${content.length}.log`);
        fs.writeFileSync(p, content);
        tmpFiles.push(p);
        return p;
    }
    function cleanupFiles() {
        while (tmpFiles.length) {
            try {
                fs.unlinkSync(tmpFiles.pop());
            } catch {
                /* ignore */
            }
        }
    }
    function removeDir() {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    }
    return { tmpDir, writeLog, cleanupFiles, removeDir };
}
