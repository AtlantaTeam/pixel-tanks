// Общие тест-хелперы для vitest-тестов scripts/ (в духе .claude/ralph/test-helpers.js).
// Держим их в одном месте, чтобы при правке сигнатуры фикстуры менять её один раз, а не
// в каждой копии (#247: fsError жил тремя копиями по разным тест-файлам).

// Ошибка чтения с кодом — как её бросает fs.readFileSync (ENOENT/EACCES): у объекта Error
// выставлен `.code`, по которому канарейка отличает «нет файла» от «не читается».
export function fsError(code) {
    const e = new Error(`${code}: fake`);
    e.code = code;
    return e;
}
