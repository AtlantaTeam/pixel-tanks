#!/usr/bin/env node
/**
 * Визуальная регрессия боевой сцены в образе `node:24` (issue #585).
 *
 * `npm run test:visual` — сверить кадры с эталонами (красный = вид сцены изменился).
 * `npm run test:visual -- --update` — пересъёмка эталонов; обновлённые кадры
 * обязан посмотреть человек, это единственный гейт вкуса (CLAUDE.md, «Дизайн-процесс»).
 * `npm run test:visual -- --skip-build` — не пересобирать приложение перед прогоном
 * (только когда точно знаешь, что `.next` соответствует дереву: устаревшая сборка
 * даёт зелёный барьер на непроверенном коде — ровно тот класс, что барьер и ловит).
 *
 * Почему контейнер: эталон без допуска в пикселях воспроизводим только в одной
 * среде — растр шрифтов и канваса зависит от Chromium, freetype и fontconfig.
 * Образ собирается один раз (единственный шаг, которому нужна сеть), дальше прогон
 * офлайн. Fail-closed: нет docker, не собрался образ, не прошёл прогон — ненулевой
 * код возврата, а не «пропустим проверку».
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = 'e2e-visual/Dockerfile';
const CONTAINER_PORT = 3053;

/** Версия playwright из установленного пакета — образ обязан нести ровно её браузер. */
export function readPlaywrightVersion(root = REPO_ROOT) {
    const manifest = resolve(root, 'node_modules/@playwright/test/package.json');
    if (!existsSync(manifest)) {
        throw new Error(
            'Не найден @playwright/test в node_modules — сначала `npm ci`: версия браузера в образе берётся из него.',
        );
    }
    const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
        throw new Error(`Непонятная версия @playwright/test: ${String(version)}`);
    }
    return version;
}

/** Имя проекта из `package.json` — часть тега образа. Читаем, а не зашиваем:
 *  `scripts/` переносится в другой проект как есть (правило чистоты ядра раннера). */
export function readProjectName(root = REPO_ROOT) {
    const { name } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const slug = String(name ?? '')
        .replace(/^@/, '')
        .replace(/[^a-z0-9-]+/gi, '-')
        .toLowerCase();
    if (!slug) throw new Error('В package.json нет пригодного `name` для тега образа');
    return slug;
}

/** Тег образа несёт версию playwright: обновили пакет — собирается новый образ,
 *  а не молча используется старый браузер. */
export function imageTag(version, project = readProjectName()) {
    return `${project}-visual:node24-pw${version}`;
}

/**
 * Аргументы `docker run`. Вынесено чистой функцией — на неё смотрит тест:
 * сеть контейнера обязана быть host (внутри поднимается свой `next start`),
 * а дерево репозитория обязано быть примонтировано на запись (эталоны пишутся в него).
 */
export function dockerRunArgs({ tag, root, command }) {
    return [
        'run',
        '--rm',
        '--network',
        'host',
        '--ipc',
        'host', // без этого Chromium в контейнере падает на нехватке /dev/shm
        '--volume',
        `${root}:/app`,
        '--workdir',
        '/app',
        '--env',
        `VISUAL_PORT=${CONTAINER_PORT}`,
        tag,
        'bash',
        '-lc',
        command,
    ];
}

/** Команда внутри контейнера: сборка (если не отключена) + прогон визуального конфига. */
export function containerCommand({ update, skipBuild }) {
    const steps = [];
    if (!skipBuild) steps.push('npm run build');
    const testCmd = ['npx playwright test --config playwright.visual.config.ts'];
    if (update) testCmd.push('--update-snapshots');
    steps.push(testCmd.join(' '));
    return steps.join(' && ');
}

function run(cmd, args, opts = {}) {
    const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT, ...opts });
    if (res.error) throw res.error;
    return res.status ?? 1;
}

function hasImage(tag) {
    const res = spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' });
    return res.status === 0;
}

function main(argv) {
    const update = argv.includes('--update') || argv.includes('--update-snapshots');
    const skipBuild = argv.includes('--skip-build');

    if (spawnSync('docker', ['--version'], { stdio: 'ignore' }).status !== 0) {
        console.error(
            '✗ docker недоступен. Эталонные кадры снимаются только в образе node:24 — без docker проверку не подменяем хостом.',
        );
        return 1;
    }

    const version = readPlaywrightVersion();
    const tag = imageTag(version);

    if (!hasImage(tag)) {
        console.log(`▶ собираю образ ${tag} (единственный шаг, которому нужна сеть)`);
        const built = run('docker', [
            'build',
            '--build-arg',
            `PLAYWRIGHT_VERSION=${version}`,
            '--tag',
            tag,
            '--file',
            DOCKERFILE,
            '.',
        ]);
        if (built !== 0) {
            console.error('✗ образ не собрался — прогон не подменяем хостовым браузером');
            return built;
        }
    }

    const command = containerCommand({ update, skipBuild });
    console.log(`▶ ${tag}: ${command}`);
    return run('docker', dockerRunArgs({ tag, root: REPO_ROOT, command }));
}

// Модуль импортируется тестом — запускаемся только как процесс.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    process.exit(main(process.argv.slice(2)));
}
