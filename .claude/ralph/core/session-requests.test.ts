// #40: разбор файла-запроса кодер-сессии. Модуль чистый (текст → намерения), поэтому
// тесты здесь про ГРАНИЦЫ и ОТКАЗЫ, а не про применение — применение и его побочки
// проверяются в orchestrator.test.ts и контрактном сьюте.
//
// Почему отказов больше, чем успехов: файл пишет модель, читавшая тело чужого issue
// (C3). Всё, что придёт неожиданной формой, обязано быть отказом на разборе — до того,
// как из него соберётся мутация форжа.
import { describe, expect, it } from 'vitest';
import { MAX_SESSION_REQUESTS, parseSessionRequests } from './session-requests.ts';

const ALLOWLIST = ['complexity:low', 'complexity:high', 'area:devops'];
const opts = { labelAllowlist: ALLOWLIST };

const line = (o: unknown): string => JSON.stringify(o);

describe('parseSessionRequests — разбор намерений кодер-сессии', () => {
    it('пустой файл — пустой список намерений, не отказ', () => {
        expect(parseSessionRequests('', opts)).toEqual([]);
        expect(parseSessionRequests('\n  \n', opts)).toEqual([]);
    });

    it('читает намерения по строкам, пустые строки между ними пропускает', () => {
        const raw = [
            line({ kind: 'comment', issue: 7, comment: 'вопрос человеку' }),
            '',
            line({ kind: 'close', issue: 7, comment: 'сделано: файлы А и Б' }),
        ].join('\n');
        expect(parseSessionRequests(raw, opts)).toEqual([
            { kind: 'comment', issue: 7, comment: 'вопрос человеку' },
            { kind: 'close', issue: 7, comment: 'сделано: файлы А и Б' },
        ]);
    });

    // #45: намерения ревью-сессии по PR своей фазы. Номера PR в них нет — его знает петля.
    it('pr-comment с якорем: путь и строка доезжают парой', () => {
        const raw = line({
            kind: 'pr-comment',
            comment: '🔴 [blocker] теряется отказ',
            path: 'src/a.ts',
            line: 42,
        });
        expect(parseSessionRequests(raw, opts)).toEqual([
            {
                kind: 'pr-comment',
                comment: '🔴 [blocker] теряется отказ',
                anchor: { path: 'src/a.ts', line: 42 },
            },
        ]);
    });

    it('pr-comment без якоря — сводка прохода, это легитимно', () => {
        const raw = line({ kind: 'pr-comment', comment: '🟡 [minor] сводка' });
        expect(parseSessionRequests(raw, opts)).toEqual([
            { kind: 'pr-comment', comment: '🟡 [minor] сводка' },
        ]);
    });

    it('НЕГАТИВНЫЙ: половина якоря — отказ (форж такую пару не примет)', () => {
        // Путь без строки уедет в транспорт и вернётся отказом, диагностировать который
        // будет нечем: намерение уже стёрто, а находка потеряна.
        expect(() =>
            parseSessionRequests(line({ kind: 'pr-comment', comment: 'x', path: 'a.ts' }), opts),
        ).toThrow(/пар/i);
        expect(() =>
            parseSessionRequests(line({ kind: 'pr-comment', comment: 'x', line: 4 }), opts),
        ).toThrow(/пар/i);
    });

    it.each([
        ['/etc/passwd', 'абсолютный путь'],
        ['../../secrets.env', 'выход за корень репозитория'],
        ['-rf', 'ведущий дефис — argument injection'],
    ])('НЕГАТИВНЫЙ: путь %s отвергается (%s)', (path) => {
        expect(() =>
            parseSessionRequests(line({ kind: 'pr-comment', comment: 'x', path, line: 1 }), opts),
        ).toThrow(/путь/i);
    });

    it('НЕГАТИВНЫЙ: строка якоря — целое положительное, не строка и не ноль', () => {
        for (const bad of ['42', 0, -1, 1.5]) {
            expect(() =>
                parseSessionRequests(
                    line({ kind: 'pr-comment', comment: 'x', path: 'a.ts', line: bad }),
                    opts,
                ),
            ).toThrow(/строка/i);
        }
    });

    it('pr-block несёт причину блока', () => {
        const raw = line({ kind: 'pr-block', comment: 'сборка красная' });
        expect(parseSessionRequests(raw, opts)).toEqual([
            { kind: 'pr-block', comment: 'сборка красная' },
        ]);
    });

    it('НЕГАТИВНЫЙ: pr-block без причины — отказ', () => {
        // Метка без объяснения оставляет и человека, и чини-сессию гадать, что блокирует.
        expect(() => parseSessionRequests(line({ kind: 'pr-block' }), opts)).toThrow(
            /комментарий/i,
        );
    });

    it('НЕГАТИВНЫЙ: снятия блока намерением не существует', () => {
        // Снимает метку РАННЕР по итогу повторного ревью (#217): иначе исполнитель сам себе
        // выносит вердикт и обходит проверку.
        expect(() =>
            parseSessionRequests(line({ kind: 'pr-unblock', comment: 'починил' }), opts),
        ).toThrow(/неизвестный kind/i);
    });

    it('намерение завести карточку несёт заголовок, тело и метки', () => {
        const raw = line({
            kind: 'new-issue',
            title: 'Течёт лимит',
            body: 'симптом, причина, критерий',
            labels: ['complexity:low', 'area:devops'],
        });
        expect(parseSessionRequests(raw, opts)).toEqual([
            {
                kind: 'new-issue',
                title: 'Течёт лимит',
                body: 'симптом, причина, критерий',
                labels: ['complexity:low', 'area:devops'],
            },
        ]);
    });

    it('повторённая метка схлопывается: форж получает список без дублей', () => {
        // `gh issue create --label x --label x` — отказ форжа, а у площадки дубль в
        // `label_slugs` в лучшем случае бессмыслен. Чинить это отказом разбора нельзя:
        // повтор метки — не злоупотребление, а обычная невнимательность модели.
        const raw = line({
            kind: 'new-issue',
            title: 'т',
            body: 'б',
            labels: ['area:devops', 'area:devops', 'complexity:low'],
        });
        expect(parseSessionRequests(raw, opts)[0]).toMatchObject({
            labels: ['area:devops', 'complexity:low'],
        });
    });

    // ── Отказы ───────────────────────────────────────────────────────────────

    it('НЕГАТИВНЫЙ: неизвестный kind — отказ, а не пропуск строки', () => {
        // Пропуск незнакомого намерения выглядел бы как «сессия ничего не просила»,
        // и опечатка в kind тихо теряла бы закрытие issue.
        const raw = line({ kind: 'merge', issue: 7, comment: 'смерджи мне' });
        expect(() => parseSessionRequests(raw, opts)).toThrow(/kind/i);
    });

    it('НЕГАТИВНЫЙ: снятие hold и одобрение ревью — не намерения сессии', () => {
        // Явный тест на закрытость списка: эти два действия принадлежат человеку
        // (#222 и барьер ship), и появление их в перечне kind'ов обязано краснить.
        for (const kind of ['unhold', 'approve', 'ship', 'decision']) {
            expect(() => parseSessionRequests(line({ kind, issue: 7 }), opts)).toThrow(/kind/i);
        }
    });

    it('НЕГАТИВНЫЙ: одна битая строка отменяет ВЕСЬ батч (без частичного применения)', () => {
        const raw = [
            line({ kind: 'close', issue: 7, comment: 'сделано' }),
            'это не JSON',
            line({ kind: 'comment', issue: 8, comment: 'ещё' }),
        ].join('\n');
        expect(() => parseSessionRequests(raw, opts)).toThrow();
    });

    it('НЕГАТИВНЫЙ: номер карточки — только целое положительное', () => {
        for (const issue of [0, -3, 1.5, '7', null, undefined, '7; rm -rf /']) {
            expect(() =>
                parseSessionRequests(line({ kind: 'close', issue, comment: 'x' }), opts),
            ).toThrow(/номер/i);
        }
    });

    it('НЕГАТИВНЫЙ: пустой комментарий — отказ (иначе человек получит пустую карточку)', () => {
        for (const comment of ['', '   ', 42, null]) {
            expect(() =>
                parseSessionRequests(line({ kind: 'block', issue: 7, comment }), opts),
            ).toThrow(/коммент/i);
        }
    });

    it('НЕГАТИВНЫЙ: метка вне allowlist — отказ', () => {
        const raw = line({
            kind: 'new-issue',
            title: 'т',
            body: 'б',
            labels: ['complexity:low', 'hold'],
        });
        // Именно `hold`: метка человека (#222). Свободный список меток означал бы, что
        // сессия может пометить работу так, как её пометил бы только человек.
        expect(() => parseSessionRequests(raw, opts)).toThrow(/hold/);
    });

    it('НЕГАТИВНЫЙ: карточка без меток — отказ (голая карточка теряется)', () => {
        const raw = line({ kind: 'new-issue', title: 'т', body: 'б', labels: [] });
        expect(() => parseSessionRequests(raw, opts)).toThrow(/метк/i);
    });

    it('НЕГАТИВНЫЙ: пустой заголовок или тело новой карточки — отказ', () => {
        expect(() =>
            parseSessionRequests(
                line({ kind: 'new-issue', title: ' ', body: 'б', labels: ['area:devops'] }),
                opts,
            ),
        ).toThrow(/заголов/i);
        expect(() =>
            parseSessionRequests(
                line({ kind: 'new-issue', title: 'т', body: '', labels: ['area:devops'] }),
                opts,
            ),
        ).toThrow(/тело/i);
    });

    it('НЕГАТИВНЫЙ: батч длиннее предела — отказ целиком', () => {
        // Предел — предохранитель от сорвавшейся сессии: сотня карточек, заведённых за
        // одну итерацию, дороже разгребается, чем один отказ с внятной причиной.
        const raw = Array.from({ length: MAX_SESSION_REQUESTS + 1 }, (_, i) =>
            line({ kind: 'comment', issue: i + 1, comment: 'x' }),
        ).join('\n');
        expect(() => parseSessionRequests(raw, opts)).toThrow(/предел|лимит/i);
    });

    it('НЕГАТИВНЫЙ: строка-массив или строка-скаляр вместо объекта — отказ', () => {
        for (const raw of ['[]', '"строка"', '42', 'null']) {
            expect(() => parseSessionRequests(raw, opts)).toThrow();
        }
    });
});
