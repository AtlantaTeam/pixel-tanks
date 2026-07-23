#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #185 (Изоляция ralph · Фаза 3): демонстрация фикстуры npm-зависимости с lifecycle-
// скриптом. Ставит фикстуру (scripts/canary-postinstall-fixture) как НАСТОЯЩУЮ зависимость
// во временный проект и прогоняет `npm ci` — тот же путь, что и в гейте. postinstall
// фикстуры применяет канареечный подход (probe.mjs) и печатает воспроизводимый отчёт,
// какие каналы к секретам петли открыты изнутри lifecycle-скрипта npm.
//
// Это РУЧНОЙ демо-скрипт (`npm run canary:postinstall`), не часть гейта и не vitest —
// как и `npm run security:canary:baseline`: на фазе 3 канарейка измеряет, а не краснит. Логику
// детекта покрывает vitest (scripts/canary-postinstall-fixture.test.js) на фикстурах, тут
// же — живой прогон реального `npm ci` на боевой машине для baseline (#187).
//
// ВАЖНАЯ ОСОБЕННОСТЬ npm 11 (см. docs/ralph-isolation/research.md): по умолчанию `npm ci`
// НЕ исполняет install-скрипты ЗАВИСИМОСТЕЙ (новый allow-scripts-гейт supply-chain) — то
// есть плоский `npm ci` гейта (ralph.js: `execSync('npm ci')`) уже сам блокирует
// postinstall скомпрометированной зависимости. Поэтому демо делает ДВА прогона:
//   1. `npm ci` как в гейте (по умолчанию) — postinstall зависимости не запускается: это
//      факт-митигация npm, его и фиксируем.
//   2. `npm ci --dangerously-allow-all-scripts --foreground-scripts` — измеряем, что
//      postinstall УВИДЕЛ БЫ, будь скрипты разрешены (старый npm, allowlist пакета,
//      явный флаг): это baseline канала до env-санации (фаза 4).
//
// Единственный неизмерительный вердикт: если любой `npm ci` завершился НЕнулевым кодом,
// значит фикстура сломала установку — прямое нарушение критерия «не ломает обычный
// `npm ci`». Тогда скрипт тоже падает ненулевым кодом, чтобы это не прошло молча.

const fixtureDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'canary-postinstall-fixture',
);
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ralph-postinstall-canary-'));

function runNpm(args, title) {
    console.log(`\n=== ${title} ===`);
    // Без шелла (argv) — значения (в т.ч. путь фикстуры) не интерпретируются шеллом.
    // stdio наследуется: отчёт postinstall уходит прямо в консоль вызывающего.
    const res = spawnSync('npm', args, { cwd: tmpDir, stdio: 'inherit', env: process.env });
    // npm вообще не запустился (нет в PATH и т.п.): spawnSync вернёт { error, status: null }.
    // Это НЕ «фикстура сломала установку», а отсутствие npm — называем причину отдельно,
    // иначе сообщение «упал (код null)» вводит в заблуждение.
    if (res.error) {
        const err = new Error(
            `\`npm ${args[0]}\` не удалось запустить (${res.error.code ?? res.error.message}) — npm есть в PATH?`,
        );
        err.exitCode = 1;
        throw err;
    }
    if (res.status !== 0) {
        // Бросаем, а не process.exit: очистка tmpDir остаётся в одном месте (finally ниже),
        // а не дублируется здесь ручным rmSync (иначе finally молчит после exit).
        const err = new Error(
            `\`npm ${args[0]}\` упал (код ${res.status}) — фикстура сломала установку.`,
        );
        err.exitCode = res.status ?? 1;
        throw err;
    }
    return res;
}

try {
    // Временный проект с единственной зависимостью — фикстурой по абсолютному file:-пути.
    writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify(
            {
                name: 'ralph-postinstall-canary-harness',
                version: '1.0.0',
                private: true,
                dependencies: { 'ralph-secret-canary-postinstall-fixture': `file:${fixtureDir}` },
            },
            null,
            4,
        ) + '\n',
    );

    // Версия npm — в шапку демо: блокировка install-скриптов зависимостей появилась в
    // npm 11 (allow-scripts). На npm <11 (или с allow-scripts/dangerously-allow-all-scripts
    // в .npmrc) postinstall в прогоне 1 выполнится — тогда «ожидаемая блокировка» неверна,
    // и читатель это увидит по версии + по отчёту прогона 1 (см. ниже).
    const npmVersion = spawnSync('npm', ['--version'], { encoding: 'utf8' }).stdout?.trim();
    console.log(`Демонстрация postinstall-канарейки во временном проекте: ${tmpDir}`);
    console.log(
        `npm --version: ${npmVersion ?? '<не определить>'} (блокировка dep-скриптов — с npm 11)`,
    );

    // install — сгенерировать package-lock.json (npm ci без него не работает).
    runNpm(['install', '--no-audit', '--no-fund'], 'npm install (генерация lockfile)');

    // Прогон 1: как в гейте. Гипотеза — на npm 11 install-скрипты зависимостей заблокированы;
    // подтверждается ОТСУТСТВИЕМ отчёта postinstall ниже. --foreground-scripts не разрешает
    // скрипты, а лишь показывает их вывод: с ним «заблокирован» (нет отчёта при видимых
    // foreground-логах) отличим от «выполнился молча».
    runNpm(
        ['ci', '--no-audit', '--no-fund', '--foreground-scripts'],
        'npm ci — путь гейта (ожидаем: install-скрипты зависимостей на npm 11 заблокированы — проверяем по отсутствию отчёта postinstall ниже)',
    );

    // Прогон 2: скрипты разрешены — измеряем, что postinstall увидел бы.
    runNpm(
        [
            'ci',
            '--no-audit',
            '--no-fund',
            '--dangerously-allow-all-scripts',
            '--foreground-scripts',
        ],
        'npm ci --dangerously-allow-all-scripts — baseline канала (что увидел бы postinstall)',
    );

    console.log('\n✓ Оба прогона `npm ci` зелёные: фикстура не ломает установку (критерий #185).');
    console.log(
        '  Отчёт postinstall выше (2-й прогон) — открытые каналы к секретам до санации (фаза 4).',
    );
    // Явный process.exit(0) НЕ ставим: после него finally-очистка tmpDir не отработала бы
    // (finally после process.exit не срабатывает) — временный каталог с копией node_modules
    // фикстуры оставался бы в /tmp на каждом прогоне, в т.ч. на боевой VDS (baseline #187).
    // Естественное завершение даёт код 0 и гарантирует finally.
} catch (e) {
    console.error(`\n⛔ ${e.message}`);
    process.exitCode = e.exitCode ?? 1;
} finally {
    rmSync(tmpDir, { recursive: true, force: true });
}
