import { describe, expect, it } from 'vitest';
import {
    containerCommand,
    dockerRunArgs,
    imageTag,
    readPlaywrightVersion,
    readProjectName,
} from './visual-baseline.mjs';

describe('imageTag', () => {
    it('несёт версию playwright в теге', () => {
        // Обновили пакет — собирается новый образ, а не молча используется старый
        // браузер: рассинхрон @playwright/test и браузера в образе даёт «Executable
        // doesn't exist» посреди прогона.
        expect(imageTag('1.62.1', 'demo')).toBe('demo-visual:node24-pw1.62.1');
    });

    it('имя проекта берёт из package.json, а не зашито в скрипт', () => {
        // `scripts/` переносится в другой проект как есть — проектных строк в коде
        // быть не должно (барьер `core-purity.test.ts`).
        expect(imageTag('1.62.1')).toBe(`${readProjectName()}-visual:node24-pw1.62.1`);
        expect(readProjectName()).toMatch(/^[a-z0-9-]+$/);
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
