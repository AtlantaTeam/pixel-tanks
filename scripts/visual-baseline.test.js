import { describe, expect, it } from 'vitest';
import {
    containerCommand,
    currentUser,
    dockerRunArgs,
    imageTag,
    readDockerfileFingerprint,
    readPlaywrightVersion,
    readProjectName,
    runVisualBaseline,
} from './visual-baseline.mjs';

describe('imageTag', () => {
    it('несёт версию playwright в теге', () => {
        // Обновили пакет — собирается новый образ, а не молча используется старый
        // браузер: рассинхрон @playwright/test и браузера в образе даёт «Executable
        // doesn't exist» посреди прогона.
        expect(imageTag('1.62.1', 'abc12345', 'demo')).toBe('demo-visual:node24-pw1.62.1-abc12345');
    });

    it('несёт отпечаток Dockerfile — правка образа собирает новый, а не переиспользует старый', () => {
        // Без отпечатка смена базы/шрифтов/установки браузера при неизменном
        // @playwright/test давала бы прогон в среде, которой в репозитории уже нет.
        expect(imageTag('1.62.1', 'aaaaaaaa', 'demo')).not.toBe(
            imageTag('1.62.1', 'bbbbbbbb', 'demo'),
        );
    });

    it('имя проекта берёт из package.json, а не зашито в скрипт', () => {
        // `scripts/` переносится в другой проект как есть — проектных строк в коде
        // быть не должно (барьер `core-purity.test.ts`).
        expect(imageTag('1.62.1')).toBe(
            `${readProjectName()}-visual:node24-pw1.62.1-${readDockerfileFingerprint()}`,
        );
        expect(readProjectName()).toMatch(/^[a-z0-9-]+$/);
    });
});

describe('readDockerfileFingerprint', () => {
    it('короткий и стабильный отпечаток содержимого Dockerfile', () => {
        expect(readDockerfileFingerprint()).toMatch(/^[0-9a-f]{8}$/);
        expect(readDockerfileFingerprint()).toBe(readDockerfileFingerprint());
    });
});

describe('readPlaywrightVersion', () => {
    it('берёт версию из установленного @playwright/test', () => {
        expect(readPlaywrightVersion()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('отказывается, когда пакета нет — а не подставляет версию наугад', () => {
        expect(() => readPlaywrightVersion('/nonexistent-root')).toThrow(/npm ci/);
    });
});

describe('dockerRunArgs', () => {
    const args = dockerRunArgs({ tag: 'img', root: '/repo', command: 'echo ok' });

    it('пускает контейнер в сеть хоста — внутри поднимается свой next start', () => {
        expect(args).toContain('--network');
        expect(args[args.indexOf('--network') + 1]).toBe('host');
    });

    it('монтирует дерево репозитория — эталоны пишутся в него, а не в контейнер', () => {
        expect(args).toContain('--volume');
        expect(args[args.indexOf('--volume') + 1]).toBe('/repo:/app');
    });

    it('отдаёт контейнеру ipc хоста — иначе Chromium падает на нехватке /dev/shm', () => {
        expect(args[args.indexOf('--ipc') + 1]).toBe('host');
    });

    it('удаляет контейнер после прогона', () => {
        expect(args).toContain('--rm');
    });

    it('пишет в дерево от uid запустившего, а не от root', () => {
        // Иначе после прогона `.next`, `test-results` и пересnятые эталоны
        // остаются root-owned: хостовый `npm run dev` падает на EACCES, а
        // `git checkout` этих файлов требует sudo.
        const withUser = dockerRunArgs({
            tag: 'img',
            root: '/repo',
            command: 'echo ok',
            user: '1000:1000',
        });
        expect(withUser[withUser.indexOf('--user') + 1]).toBe('1000:1000');
    });

    it('там, где uid нет (Windows), --user не передаётся вовсе', () => {
        expect(
            dockerRunArgs({ tag: 'img', root: '/repo', command: 'echo ok', user: null }),
        ).not.toContain('--user');
    });

    it('отдаёт npm писчий HOME — иначе непривилегированный uid не соберёт приложение', () => {
        expect(args).toContain('HOME=/tmp');
        expect(args).toContain('npm_config_cache=/tmp/.npm');
    });
});

describe('currentUser', () => {
    it('на posix отдаёт uid:gid, на системах без них — null', () => {
        const user = currentUser();
        if (typeof process.getuid === 'function') {
            expect(user).toBe(`${process.getuid()}:${process.getgid()}`);
        } else {
            expect(user).toBeNull();
        }
    });
});

describe('runVisualBaseline (fail-closed)', () => {
    /** Швы наружу с записью вызовов — тест смотрит и на код возврата, и на то,
     *  что прогон вообще не состоялся. */
    function ops(overrides = {}) {
        const calls = { built: 0, ran: 0, errors: [] };
        return {
            calls,
            hasDocker: () => true,
            hasImage: () => true,
            readVersion: () => '1.62.1',
            imageTag: (version) => `demo-visual:node24-pw${version}-abc12345`,
            build: () => {
                calls.built += 1;
                return 0;
            },
            run: () => {
                calls.ran += 1;
                return 0;
            },
            log: () => {},
            error: (message) => calls.errors.push(message),
            ...overrides,
        };
    }

    it('нет docker — код 1 и НИ ОДНОГО прогона: проверку не подменяем хостом', () => {
        const o = ops({ hasDocker: () => false });

        expect(runVisualBaseline([], o)).toBe(1);
        expect(o.calls.ran).toBe(0);
        expect(o.calls.built).toBe(0);
        expect(o.calls.errors.join(' ')).toMatch(/docker недоступен/);
    });

    it('образ не собрался — возвращает код сборки и прогон не запускает', () => {
        const o = ops({ hasImage: () => false, build: () => 7 });

        expect(runVisualBaseline([], o)).toBe(7);
        expect(o.calls.ran).toBe(0);
    });

    it('образа нет — сначала сборка, потом прогон', () => {
        const o = ops({ hasImage: () => false });

        expect(runVisualBaseline([], o)).toBe(0);
        expect(o.calls.built).toBe(1);
        expect(o.calls.ran).toBe(1);
    });

    it('образ уже есть — сборку не повторяем', () => {
        const o = ops();

        expect(runVisualBaseline([], o)).toBe(0);
        expect(o.calls.built).toBe(0);
        expect(o.calls.ran).toBe(1);
    });

    it('красный прогон отдаёт свой код наружу — гейт обязан покраснеть', () => {
        const o = ops({ run: () => 1 });

        expect(runVisualBaseline([], o)).toBe(1);
    });

    it('--update доезжает до команды контейнера', () => {
        let command = '';
        const o = ops({
            run: (args) => {
                command = args.command;
                return 0;
            },
        });

        runVisualBaseline(['--update'], o);

        expect(command).toContain('--update-snapshots');
    });
});

describe('containerCommand', () => {
    it('по умолчанию пересобирает приложение перед сверкой', () => {
        // Устаревшая сборка дала бы зелёный барьер на непроверенном коде — ровно тот
        // класс дефектов, ради которого барьер и заводится.
        expect(containerCommand({ update: false, skipBuild: false })).toBe(
            'npm run build && npx playwright test --config playwright.visual.config.ts',
        );
    });

    it('--skip-build убирает сборку, оставляя прогон', () => {
        expect(containerCommand({ update: false, skipBuild: true })).toBe(
            'npx playwright test --config playwright.visual.config.ts',
        );
    });

    it('--update добавляет пересъёмку эталонов', () => {
        expect(containerCommand({ update: true, skipBuild: true })).toContain('--update-snapshots');
    });

    it('без --update пересъёмки не происходит — сверка не переписывает эталон молча', () => {
        expect(containerCommand({ update: false, skipBuild: true })).not.toContain(
            '--update-snapshots',
        );
    });
});
