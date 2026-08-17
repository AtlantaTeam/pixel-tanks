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
import { createHash } from 'node:crypto';
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

/**
 * Отпечаток самого Dockerfile — вторая половина тега.
 *
 * Без него правка образа (сменили базу, добавили шрифты, переложили браузер) при
 * неизменном `@playwright/test` не собирала бы ничего: `hasImage` находил старый тег
 * и молча переиспользовал среду, которой в репозитории уже нет. Это тот же класс
 * «зелёный барьер на непроверенном», от которого предостерегает `--skip-build`.
 */
export function readDockerfileFingerprint(root = REPO_ROOT) {
    const contents = readFileSync(resolve(root, DOCKERFILE));
    return createHash('sha256').update(contents).digest('hex').slice(0, 8);
}

/** Тег образа несёт версию playwright И отпечаток Dockerfile: обновили пакет или
 *  правили образ — собирается новый, а не молча используется старый браузер. */
export function imageTag(
    version,
    fingerprint = readDockerfileFingerprint(),
    project = readProjectName(),
) {
    return `${project}-visual:node24-pw${version}-${fingerprint}`;
}

/**
 * Аргументы `docker run`. Вынесено чистой функцией — на неё смотрит тест:
 * сеть контейнера обязана быть host (внутри поднимается свой `next start`),
 * а дерево репозитория обязано быть примонтировано на запись (эталоны пишутся в него).
 */
export function dockerRunArgs({ tag, root, command, user = currentUser() }) {
    return [
        'run',
        '--rm',
        '--network',
        'host',
        '--ipc',
        'host', // без этого Chromium в контейнере падает на нехватке /dev/shm
        // Контейнер пишет в примонтированное дерево (`.next`, `test-results`,
        // пересnятые эталоны) — от uid запустившего, а не от root: иначе после
        // прогона хостовый `npm run dev` падал бы на EACCES, а `git checkout`
        // этих файлов требовал sudo (ревью #585). Работает в паре с
        // `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` в образе: браузер в
        // `/root/.cache` непривилегированному uid не виден.
        ...(user ? ['--user', user] : []),
        // HOME по умолчанию `/root` — непривилегированному uid туда не записать,
        // а npm/npx требуют писать в кеш. Отдаём им `/tmp` внутри контейнера.
        '--env',
        'HOME=/tmp',
        '--env',
        'npm_config_cache=/tmp/.npm',
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

/** `uid:gid` текущего процесса или null там, где их нет (Windows). */
export function currentUser() {
    if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') return null;
    return `${process.getuid()}:${process.getgid()}`;
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

/** Аргументы `docker build` — вынесено, чтобы тег и `PLAYWRIGHT_VERSION` не
 *  расходились между сборкой и запуском. */
export function dockerBuildArgs({ tag, version }) {
    return [
        'build',
        '--build-arg',
        `PLAYWRIGHT_VERSION=${version}`,
        '--tag',
        tag,
        '--file',
        DOCKERFILE,
        '.',
    ];
}

/**
 * Вся логика прогона одним чистым сценарием поверх инжектируемых операций —
 * ровно ради теста fail-closed веток (ревью #585).
 *
 * Fail-closed — главное свойство этого скрипта, но раньше под тестом были только
 * хелперы: «нет docker → код 1, а не пропуск проверки» и «образ не собрался →
 * ненулевой код» не проверялось ничем, хотя однажды `return 1` превратится в
 * `return 0` и это никто не заметит.
 *
 * `ops` — швы наружу: наличие docker, наличие образа, сборка, запуск, вывод.
 */
export function runVisualBaseline(argv, ops) {
    const update = argv.includes('--update') || argv.includes('--update-snapshots');
    const skipBuild = argv.includes('--skip-build');

    if (!ops.hasDocker()) {
        ops.error(
            '✗ docker недоступен. Эталонные кадры снимаются только в образе node:24 — без docker проверку не подменяем хостом.',
        );
        return 1;
    }

    const version = ops.readVersion();
    const tag = ops.imageTag(version);

    if (!ops.hasImage(tag)) {
        ops.log(`▶ собираю образ ${tag} (единственный шаг, которому нужна сеть)`);
        const built = ops.build({ tag, version });
        if (built !== 0) {
            // Возвращаем код сборки: непостроенный образ — это отказ проверки, а
            // не её успешное отсутствие.
            ops.error('✗ образ не собрался — прогон не подменяем хостовым браузером');
            return built;
        }
    }

    const command = containerCommand({ update, skipBuild });
    ops.log(`▶ ${tag}: ${command}`);
    return ops.run({ tag, command });
}

/** Боевые реализации швов: настоящие docker и файловая система. */
function defaultOps() {
    return {
        hasDocker: () => spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0,
        hasImage: (tag) =>
            spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' }).status === 0,
        readVersion: () => readPlaywrightVersion(),
        imageTag: (version) => imageTag(version),
        build: ({ tag, version }) => run('docker', dockerBuildArgs({ tag, version })),
        run: ({ tag, command }) => run('docker', dockerRunArgs({ tag, root: REPO_ROOT, command })),
        log: (message) => console.log(message),
        error: (message) => console.error(message),
    };
}

// Модуль импортируется тестом — запускаемся только как процесс.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    process.exit(runVisualBaseline(process.argv.slice(2), defaultOps()));
}
