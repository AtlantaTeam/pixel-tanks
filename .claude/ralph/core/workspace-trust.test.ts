// Юнит-тесты доверия рабочему дереву (#576). Проверяют три вещи, каждая из которых
// однажды уже стоила петле всех 32 разрешений `permissions.allow`:
// 1) канонизация ключа доверия — для ЛИНКОВАННОГО worktree Claude CLI спрашивает не путь
//    дерева, а корень ОСНОВНОГО дерева репозитория (эмпирика в докблоке модуля);
// 2) чистое преобразование конфига — правим ровно свои записи, остальное не теряем;
// 3) режим отказа — любой сбой виден как отказ раннера, а не как строка внутри вывода
//    кодер-сессии.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    TRUST_FLAG,
    claudeConfigPath,
    canonicalWorkspaceRoot,
    trustTargets,
    withTrustedWorkspaces,
    ensureWorkspaceTrusted,
} from './workspace-trust.ts';
import { sideEffectAttempts } from '../shared/side-effect-guard.ts';

// Платформенное: тест оперирует POSIX-путями (как весь раннер, живущий на Linux-VDS) —
// та же пометка, что в worktree.test.ts, а не вторая реализация под Windows.
const itPosix = it.skipIf(process.platform === 'win32');

describe('claudeConfigPath — где лежит глобальный конфиг Claude CLI', () => {
    itPosix('по умолчанию — <home>/.claude.json', () => {
        expect(claudeConfigPath({}, () => '/root')).toBe('/root/.claude.json');
    });

    itPosix('CLAUDE_CONFIG_DIR важнее home — сессия читает оттуда же, что и раннер', () => {
        expect(claudeConfigPath({ CLAUDE_CONFIG_DIR: '/tmp/cfg' }, () => '/root')).toBe(
            '/tmp/cfg/.claude.json',
        );
    });
});

describe('canonicalWorkspaceRoot — ключ доверия для линкованного worktree (#576)', () => {
    // Раскладка git: worktree /wt содержит ФАЙЛ .git с указателем на
    // /main/.git/worktrees/wt, а там commondir указывает обратно на /main/.git.
    function fakeGitFs(files: Record<string, string>) {
        return (p: string) => {
            if (p in files) return files[p];
            const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
            e.code = 'ENOENT';
            throw e;
        };
    }

    itPosix('worktree → корень ОСНОВНОГО дерева репозитория, а не путь самого worktree', () => {
        const readFileFn = fakeGitFs({
            '/root/app-ralph/.git': 'gitdir: /root/app/.git/worktrees/app-ralph\n',
            '/root/app/.git/worktrees/app-ralph/commondir': '../..\n',
        });
        expect(canonicalWorkspaceRoot('/root/app-ralph', { readFileFn })).toBe('/root/app');
    });

    itPosix('обычный клон (.git — папка, чтение падает EISDIR) → сам путь', () => {
        const readFileFn = () => {
            const e = new Error('EISDIR') as NodeJS.ErrnoException;
            e.code = 'EISDIR';
            throw e;
        };
        expect(canonicalWorkspaceRoot('/root/app', { readFileFn })).toBe('/root/app');
    });

    itPosix('.git есть, но это не указатель gitdir → сам путь', () => {
        const readFileFn = fakeGitFs({ '/root/app/.git': 'что-то постороннее\n' });
        expect(canonicalWorkspaceRoot('/root/app', { readFileFn })).toBe('/root/app');
    });

    itPosix('gitdir есть, commondir не читается → сам путь (не угадываем)', () => {
        const readFileFn = fakeGitFs({
            '/root/app-ralph/.git': 'gitdir: /root/app/.git/worktrees/app-ralph\n',
        });
        expect(canonicalWorkspaceRoot('/root/app-ralph', { readFileFn })).toBe('/root/app-ralph');
    });

    itPosix('submodule (gitdir в .git/modules, а не в .git/worktrees) → сам путь', () => {
        const readFileFn = fakeGitFs({
            '/root/app/vendor/lib/.git': 'gitdir: /root/app/.git/modules/lib\n',
            '/root/app/.git/modules/lib/commondir': '../..\n',
        });
        expect(canonicalWorkspaceRoot('/root/app/vendor/lib', { readFileFn })).toBe(
            '/root/app/vendor/lib',
        );
    });

    // `git init --separate-git-dir` / `core.worktree`: общий каталог зовётся не `.git`
    // (например /gitdirs/app.git), и рабочего дерева РЯДОМ с ним нет. Отдать здесь
    // dirname(common) значило бы внести в доверенные каталог, который никакой сессии не
    // соответствует, — «внесено» в логе при по-прежнему отброшенных разрешениях.
    itPosix('общий каталог не .git (separate-git-dir) → сам путь, а не угаданный корень', () => {
        const readFileFn = fakeGitFs({
            '/root/app-ralph/.git': 'gitdir: /gitdirs/app.git/worktrees/app-ralph\n',
            '/gitdirs/app.git/worktrees/app-ralph/commondir': '../..\n',
        });
        expect(canonicalWorkspaceRoot('/root/app-ralph', { readFileFn })).toBe('/root/app-ralph');
    });

    itPosix('относительный gitdir резолвится от самого worktree', () => {
        const readFileFn = fakeGitFs({
            '/root/app-ralph/.git': 'gitdir: ../app/.git/worktrees/app-ralph\n',
            '/root/app/.git/worktrees/app-ralph/commondir': '../..\n',
        });
        expect(canonicalWorkspaceRoot('/root/app-ralph', { readFileFn })).toBe('/root/app');
    });

    // Боевой дефолт readFileFn на НАСТОЯЩЕЙ раскладке файлов (git не зовём — только те
    // файлы, что git кладёт): DI-тесты выше проверяют правило, этот — что дефолт до него
    // вообще доходит и путь резолвится реальным fs.
    itPosix('боевой readFileSync на реальной раскладке файлов worktree', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-trust-'));
        try {
            const main = path.join(tmp, 'app');
            const wt = path.join(tmp, 'app-ralph');
            const gitdir = path.join(main, '.git', 'worktrees', 'app-ralph');
            fs.mkdirSync(gitdir, { recursive: true });
            fs.mkdirSync(wt, { recursive: true });
            fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n');
            fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdir}\n`);
            expect(canonicalWorkspaceRoot(wt)).toBe(main);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe('trustTargets — что именно вносим в доверенные', () => {
    itPosix('worktree: канонический корень ПЕРВЫМ, путь дерева следом', () => {
        const canonicalFn = () => '/root/app';
        expect(trustTargets('/root/app-ralph', { canonicalFn })).toEqual([
            '/root/app',
            '/root/app-ralph',
        ]);
    });

    itPosix('канонический корень совпал с путём — один элемент, без дубля', () => {
        const canonicalFn = (d: string) => d;
        expect(trustTargets('/root/app', { canonicalFn })).toEqual(['/root/app']);
    });
});

describe('withTrustedWorkspaces — чистое преобразование глобального конфига', () => {
    itPosix('пустой конфиг → появляется projects с флагом доверия', () => {
        const { config, added } = withTrustedWorkspaces(undefined, ['/root/app']);
        expect(config).toEqual({ projects: { '/root/app': { [TRUST_FLAG]: true } } });
        expect(added).toEqual(['/root/app']);
    });

    itPosix('запись с false → true, ОСТАЛЬНЫЕ поля записи сохранены', () => {
        const raw = {
            projects: {
                '/root/app': {
                    [TRUST_FLAG]: false,
                    allowedTools: [],
                    projectOnboardingSeenCount: 0,
                },
            },
        };
        const { config, added } = withTrustedWorkspaces(raw, ['/root/app']);
        expect(config.projects).toEqual({
            '/root/app': { [TRUST_FLAG]: true, allowedTools: [], projectOnboardingSeenCount: 0 },
        });
        expect(added).toEqual(['/root/app']);
    });

    itPosix('уже доверен → added пуст (писать файл незачем)', () => {
        const raw = { projects: { '/root/app': { [TRUST_FLAG]: true } } };
        expect(withTrustedWorkspaces(raw, ['/root/app']).added).toEqual([]);
    });

    itPosix('чужие ключи конфига и чужие проекты не теряются', () => {
        const raw = {
            numStartups: 14,
            oauthAccount: { accountUuid: 'u' },
            projects: { '/root/other': { [TRUST_FLAG]: true } },
        };
        const { config } = withTrustedWorkspaces(raw, ['/root/app']);
        expect(config.numStartups).toBe(14);
        expect(config.oauthAccount).toEqual({ accountUuid: 'u' });
        expect((config.projects as Record<string, unknown>)['/root/other']).toEqual({
            [TRUST_FLAG]: true,
        });
    });

    itPosix('исходный объект НЕ мутируется (чистая функция)', () => {
        const raw = { projects: { '/root/app': { [TRUST_FLAG]: false } } };
        withTrustedWorkspaces(raw, ['/root/app']);
        expect(raw.projects['/root/app'][TRUST_FLAG]).toBe(false);
    });

    itPosix('конфиг не объект (массив/строка/null) → бросает, а не чинит молча', () => {
        expect(() => withTrustedWorkspaces([], ['/root/app'])).toThrow(/не JSON-объект/);
        expect(() => withTrustedWorkspaces('строка', ['/root/app'])).toThrow(/не JSON-объект/);
        expect(() => withTrustedWorkspaces(null, ['/root/app'])).toThrow(/не JSON-объект/);
    });

    // Документированное поведение докблока: конфиг битый ровно в СВОЕЙ записи (обрезанный
    // либо правленный руками ~/.claude.json) — чиним заменой своего ключа, не бросая.
    // Без этого теста поведение можно было бы случайно поменять на бросок, не покраснив.
    itPosix('своя запись не объект → заменяем её, чужие ключи не трогаем', () => {
        const raw = { projects: { '/root/app': 'строка', '/root/other': { keep: 1 } } };
        const { config, added } = withTrustedWorkspaces(raw, ['/root/app']);
        expect((config.projects as Record<string, unknown>)['/root/app']).toEqual({
            [TRUST_FLAG]: true,
        });
        expect((config.projects as Record<string, unknown>)['/root/other']).toEqual({ keep: 1 });
        expect(added).toEqual(['/root/app']);
    });

    itPosix('projects не объект → бросает', () => {
        expect(() => withTrustedWorkspaces({ projects: [] }, ['/root/app'])).toThrow(/projects/);
    });

    itPosix('относительный путь в целях → бросает (ключ обязан быть абсолютным)', () => {
        expect(() => withTrustedWorkspaces({}, ['app-ralph'])).toThrow(/абсолют/);
    });
});

describe('ensureWorkspaceTrusted — запись доверия и режим отказа (#576)', () => {
    const TARGETS = ['/root/app', '/root/app-ralph'];
    const targetsFn = () => TARGETS;

    afterEach(() => {
        vi.restoreAllMocks();
    });

    itPosix('конфига ещё нет (свежая машина, провижн) → создаём с доверием', () => {
        const writeFileFn = vi.fn();
        const logFn = vi.fn();
        const readFileFn = () => {
            const e = new Error('ENOENT') as NodeJS.ErrnoException;
            e.code = 'ENOENT';
            throw e;
        };
        const changed = ensureWorkspaceTrusted('/root/app-ralph', {
            configPath: '/root/.claude.json',
            readFileFn,
            writeFileFn,
            targetsFn,
            logFn,
            failFn: (m: string) => {
                throw new Error(m);
            },
        });
        expect(changed).toBe('written');
        const [p, data] = writeFileFn.mock.calls[0] as [string, string];
        expect(p).toBe('/root/.claude.json');
        expect(JSON.parse(data).projects).toEqual({
            '/root/app': { [TRUST_FLAG]: true },
            '/root/app-ralph': { [TRUST_FLAG]: true },
        });
    });

    itPosix('уже доверено → файл НЕ переписываем (чужие правки конфига не затираем)', () => {
        const writeFileFn = vi.fn();
        const logFn = vi.fn();
        const readFileFn = () =>
            JSON.stringify({
                projects: {
                    '/root/app': { [TRUST_FLAG]: true },
                    '/root/app-ralph': { [TRUST_FLAG]: true },
                },
            });
        const changed = ensureWorkspaceTrusted('/root/app-ralph', {
            configPath: '/root/.claude.json',
            readFileFn,
            writeFileFn,
            targetsFn,
            logFn,
            failFn: (m: string) => {
                throw new Error(m);
            },
        });
        // Исход РАЗЛИЧИМ: «уже доверено» — не то же самое, что «не смогли» (прежний общий
        // `false` делал fail-closed невыразимым у вызывающего).
        expect(changed).toBe('already');
        expect(writeFileFn).not.toHaveBeenCalled();
        expect(logFn.mock.calls.join(' ')).toMatch(/уже доверен/);
    });

    itPosix('битый JSON конфига → ВИДИМЫЙ отказ раннера, файл не переписываем', () => {
        const writeFileFn = vi.fn();
        const failFn = vi.fn((m: string) => {
            throw new Error(m);
        });
        expect(() =>
            ensureWorkspaceTrusted('/root/app-ralph', {
                configPath: '/root/.claude.json',
                readFileFn: () => '{ это не json',
                writeFileFn,
                targetsFn,
                logFn: () => {},
                failFn,
            }),
        ).toThrow(/не разбирается как JSON/);
        expect(writeFileFn).not.toHaveBeenCalled();
    });

    itPosix('конфиг не читается (не ENOENT: права/IO) → видимый отказ', () => {
        const failFn = vi.fn((m: string) => {
            throw new Error(m);
        });
        const readFileFn = () => {
            const e = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
            e.code = 'EACCES';
            throw e;
        };
        expect(() =>
            ensureWorkspaceTrusted('/root/app-ralph', {
                configPath: '/root/.claude.json',
                readFileFn,
                writeFileFn: vi.fn(),
                targetsFn,
                logFn: () => {},
                failFn,
            }),
        ).toThrow(/не читается/);
    });

    itPosix('запись упала → видимый отказ (доверие не состоялось — молчать нельзя)', () => {
        const failFn = vi.fn((m: string) => {
            throw new Error(m);
        });
        expect(() =>
            ensureWorkspaceTrusted('/root/app-ralph', {
                configPath: '/root/.claude.json',
                readFileFn: () => '{}',
                writeFileFn: () => {
                    throw new Error('EROFS: read-only file system');
                },
                targetsFn,
                logFn: () => {},
                failFn,
            }),
        ).toThrow(/не записан|EROFS/);
    });

    // Контракт исхода: даже если failFn НЕ бросает (мок, обёртка вокруг боевого fail),
    // функция обязана вернуть 'failed' — по нему вызывающий (ensureRunnerWorktree)
    // останавливается сам, а не надеется на чужой process.exit.
    itPosix("сбой при не-бросающем failFn → исход 'failed', а не 'already'", () => {
        const failFn = vi.fn(() => undefined);
        const outcome = ensureWorkspaceTrusted('/root/app-ralph', {
            configPath: '/root/.claude.json',
            readFileFn: () => '{ это не json',
            writeFileFn: vi.fn(),
            targetsFn,
            logFn: () => {},
            failFn,
        });
        expect(outcome).toBe('failed');
        expect(failFn).toHaveBeenCalledTimes(1);
    });

    // Боевой дефольт writeFileFn обязан быть под предохранителем #138: забытый в тесте
    // override иначе переписал бы НАСТОЯЩИЙ ~/.claude.json машины, где идут тесты.
    itPosix('боевой writeFileFn под guardSideEffect (#138)', () => {
        const prev = process.env.RALPH_NO_SIDE_EFFECTS;
        process.env.RALPH_NO_SIDE_EFFECTS = '1';
        const failFn = vi.fn((m: string) => {
            throw new Error(m);
        });
        try {
            expect(() =>
                ensureWorkspaceTrusted('/root/app-ralph', {
                    configPath: '/tmp/never-written.claude.json',
                    readFileFn: () => '{}',
                    targetsFn,
                    logFn: () => {},
                    failFn,
                }),
            ).toThrow(/побочка|не записан/);
            // Журнал общий (test-setup.ts сверяет его с пустотой в afterEach) — попытка
            // здесь ОЖИДАЕМАЯ, поэтому забираем её сами.
            expect(sideEffectAttempts.splice(0).join(' ')).toMatch(/ensureWorkspaceTrusted/);
        } finally {
            if (prev === undefined) delete process.env.RALPH_NO_SIDE_EFFECTS;
            else process.env.RALPH_NO_SIDE_EFFECTS = prev;
        }
    });
});
