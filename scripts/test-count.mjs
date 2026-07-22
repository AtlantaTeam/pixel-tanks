#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// #154: источник числа unit-тестов для храповика (#156) — детерминированный машинный
// отчёт vitest, а НЕ парсинг человекочитаемого stdout (текстовый вывод меняется между
// версиями/локалями и никогда не был контрактом — regex по нему рано или поздно молча
// ломается на безобидном апдейте).
//
// `vitest list` (СБОР тест-кейсов без прогона), а не `vitest run` (#156): храповику нужно
// только число существующих тестов, а не результат прогона. Число совпадает с numTotalTests
// полного прогона (сбор считает те же тест-кейсы, включая пропущенные) — проверено на этом
// репозитории, — поэтому гейт-чек храповика попадает в НАЧАЛО fail-fast порядка
// («секундный», #156) и не дублирует ~20-секундный `test`, который гейт и так гоняет.
//
// --no-isolate — вот что делает чек «секундным»: голый `vitest list` тратит ~20с (замер),
// потому что изоляция поднимает свежее окружение (happy-dom) под КАЖДЫЙ из ~50 файлов
// app-проекта; для СБОРА (файлы только импортируются ради перечня it(), тесты не
// исполняются) изоляция не нужна. Без неё — ~6с, и число то же (флаг влияет на семантику
// ИСПОЛНЕНИЯ, не на сбор — проверено). Это нижний предел честного независимого подсчёта:
// трансформ исходников app эсбилдом; быстрее только читая артефакт чужого прогона, но тогда
// чек уже не «в начале» и зависит от порядка чеков.
//
// Пул НЕ трогаем (дефолтные forks): `--pool=threads` под `--no-isolate` даёт НЕДЕТЕРМИНИРО-
// ванный счёт (замер: 919/939/930 в разных прогонах) — потоки делят память и гонятся на
// сборе, а храповику это отравой: счёт обязан быть детерминированным, иначе гейт краснеет по
// флаку, а не по потере тестов. Forks — отдельные процессы, гонки нет, счёт стабилен от
// прогона к прогону (проверено 5×).
//
// --json=<file>, не голый stdout: vite может подмешать в stdout предупреждения сбора —
// один смешанный поток JSON.parse не переживёт. Файл на диске — чистый канал.
// mkdtempSync — каталог 0700 со случайным суффиксом. Предсказуемое имя в общем /tmp
// (pid+таймштамп угадываются) — классическая поверхность для symlink-подмены в multi-user
// окружении: vitest перезаписал бы то, куда указывает подложенная ссылка. На выделенном
// VDS риск теоретический, но так и непредсказуемость, и приватный каталог — дешевле, чем
// спорить о модели угроз.
function defaultOutputFile() {
    return path.join(mkdtempSync(path.join(os.tmpdir(), 'test-count-')), 'vitest-list.json');
}

// Ненулевой код спавна тут возможен (например, ошибка сбора в одном файле) — но список
// пишется в файл, и решение принимает чтение ниже: файла нет → fail-closed throw. Сбой
// самого запуска (vitest не стартовал) файла не пишет — ловится там же.
//
// --no-install у npx: без него отсутствие локального vitest ушло бы в сеть за пакетом —
// ровно та зависимость гейта от сети, которая уже один раз красила build (#206).
export function collectTestsJson(spawnFn = spawnSync, outputFile = defaultOutputFile()) {
    const result = spawnFn(
        'npx',
        ['--no-install', 'vitest', 'list', '--no-isolate', `--json=${outputFile}`],
        {
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
        },
    );

    let raw;
    try {
        raw = readFileSync(outputFile, 'utf8');
    } catch (e) {
        // При реальном сбое сбора (синтаксическая ошибка в тест-файле, упавший конфиг)
        // vitest пишет причину в stderr — без неё чини-сессия видела бы только ENOENT и
        // чинить ей нечего (тот же класс, что чинили в security-audit.mjs по ревью #141).
        const why =
            result?.error?.message ||
            (typeof result?.status === 'number'
                ? `код выхода ${result.status}`
                : 'причина неизвестна');
        const stderrTail = (result?.stderr || '').trim().slice(-2000);
        throw new Error(
            `vitest не записал список тестов (${outputFile}) — сбой сбора: ${e.message}; ` +
                `${why}${stderrTail ? `; stderr: ${stderrTail}` : ''}`,
        );
    } finally {
        // Убираем и файл, и созданный под него временный каталог (mkdtemp). Каталог сносим
        // только если это наш temp (test-count-*), чтобы переданный через DI путь не задеть.
        try {
            unlinkSync(outputFile);
        } catch {
            /* временный файл — не критично, если уже удалён или недоступен */
        }
        const dir = path.dirname(outputFile);
        if (path.basename(dir).startsWith('test-count-')) {
            try {
                rmSync(dir, { recursive: true, force: true });
            } catch {
                /* временный каталог — не критично, если уже удалён или недоступен */
            }
        }
    }

    try {
        return JSON.parse(raw);
    } catch (e) {
        // Файл к этому моменту уже удалён в finally — путь бесполезен; показываем начало
        // самого нераспарсенного вывода, иначе битый отчёт пришлось бы отлаживать вслепую.
        throw new Error(
            `список тестов vitest не распарсился: ${e.message} — начало вывода: ` +
                `${raw.slice(0, 200)}`,
        );
    }
}

// Формат зафиксирован (vitest list --json): МАССИВ записей о тест-кейсах, у каждой строковые
// name и file. Число тестов = длина массива. Неожиданный формат (не массив, запись без
// строковых name/file) — throw, не «посчитаем как есть»: тихий счёт по сломанному отчёту
// храповик (#156) прочитал бы как «тесты пропали» и покрасил бы гейт по ложной причине.
export function countTests(report) {
    if (!Array.isArray(report)) {
        throw new Error(
            `vitest list --json вернул не массив — формат репортёра неожиданный ` +
                `(получено: ${JSON.stringify(report)})`,
        );
    }
    for (const entry of report) {
        if (typeof entry?.name !== 'string' || typeof entry?.file !== 'string') {
            throw new Error(
                `запись списка тестов без строковых name/file — формат vitest list изменился ` +
                    `(получено: ${JSON.stringify(entry)})`,
            );
        }
    }
    return report.length;
}

function main() {
    let report;
    try {
        report = collectTestsJson();
    } catch (e) {
        console.error(`⛔ test-count: ${e.message}`);
        process.exit(1);
    }

    let count;
    try {
        count = countTests(report);
    } catch (e) {
        console.error(`⛔ test-count: ${e.message}`);
        process.exit(1);
    }

    console.log(count);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
