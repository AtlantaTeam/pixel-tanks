'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { isDailySeed, ShareDailyResultButton, submitDailyScore } from '@/features/daily-challenge';
import {
    computeBattleStats,
    computeLeaderboardPoints,
    deriveOutcome,
    MOVE_BUDGET,
    useGameStore,
} from '@/features/game-engine';
import { ShareReplayButton } from '@/features/replays';
import { BOT_NAME } from '@/shared/config';
import { ThemeScope, type TOutcome } from '@/shared/lib/theme';
import { Button, Dialog, buttonClasses } from '@/shared/ui';

type TGameOverDialogProps = {
    seed?: string;
    /** Проброс `Dialog.variant` (по умолчанию боевой `'modal'`) — витрина
     *  `/design-system` показывает исход статичным срезом `'static'`: в потоке
     *  страницы, без `fixed` и без кражи фокуса, как `PauseOverlay` (#347). */
    dialogVariant?: 'modal' | 'static';
    /** Витрина: показать конкретный исход, НЕ мутируя боевой `useGameStore` —
     *  три среза (победа/поражение/ничья) сосуществуют независимо. Диалог
     *  считается открытым, а HP и статистика берутся отсюда, а не из стора.
     *  `shots`/`hits`/`maneuvers` необязательны (по умолчанию 0) — задаются, чтобы
     *  витрина показала непустую статистику. В этом режиме гасятся и все
     *  привязанные к бою ветки (daily-блок, «Поделиться боем»): срез статичен и не
     *  должен внезапно показать их, если в этой же сессии сначала сыграли бой, а
     *  потом ушли на витрину. */
    preview?: { player: number; enemy: number; shots?: number; hits?: number; maneuvers?: number };
    /** id заголовка (`aria-labelledby`). По умолчанию `'game-over-title'`; на
     *  витрине несколько диалогов на одной странице — нужен уникальный, иначе id
     *  дублируется в DOM. */
    titleId?: string;
};

/**
 * Помечает seed «Боя дня» как отправленный на уровне сессии браузера, чтобы
 * «Новая игра» (reload того же daily-URL) не давала переотправить результат
 * повторно. До Auth это не полная защита от накрутки (нужен серверный дедуп
 * `user+dailySeed`), но убирает тривиальный «сыграл → reload → снова отправил».
 */
const submittedStorageKey = (seed: string) => `daily-submitted:${seed}`;

const wasDailyScoreSubmitted = (seed: string): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return window.sessionStorage.getItem(submittedStorageKey(seed)) !== null;
    } catch {
        return false;
    }
};

const markDailyScoreSubmitted = (seed: string): void => {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(submittedStorageKey(seed), '1');
    } catch {
        // sessionStorage недоступен (приватный режим и т.п.) — не критично.
    }
};

export function GameOverDialog({
    seed,
    dialogVariant = 'modal',
    preview,
    titleId = 'game-over-title',
}: TGameOverDialogProps = {}) {
    const isGameOver = useGameStore((s) => s.isGameOver);
    const liveHp = useGameStore((s) => s.hp);
    const finalHp = useGameStore((s) => s.finalHp);
    // Снимок фиксируется один раз на переходе isGameOver false→true
    // (useGameStore.setGameOver) — пока бой идёт, снимка нет, и заголовок
    // читает живой HP (#337). В режиме `preview` (витрина) HP задан пропом,
    // а стор не читаем и не трогаем.
    const open = preview ? true : isGameOver;
    const playerHp = preview ? preview.player : (finalHp?.player ?? liveHp.player);
    const enemyHp = preview ? preview.enemy : (finalHp?.enemy ?? liveHp.enemy);
    const shotsFired = useGameStore((s) => s.shotsFired);
    const hits = useGameStore((s) => s.hits);
    const moves = useGameStore((s) => s.moves);
    const battleSeed = useGameStore((s) => s.battleSeed);
    const battleField = useGameStore((s) => s.battleField);
    const replayMoves = useGameStore((s) => s.replayMoves);
    const resetGame = useGameStore((s) => s.resetGame);
    const submittedRef = useRef(false);

    // Статистика боя (handoff «Game over»): урон, точность, выстрелы, манёвры.
    // Совершено манёвров = бюджет − остаток. В preview (витрина) входы приходят
    // пропом, в бою — из стора; HP берём из снимка finalHp (#337).
    const stats = computeBattleStats({
        playerHp,
        enemyHp,
        shots: preview ? (preview.shots ?? 0) : shotsFired,
        hits: preview ? (preview.hits ?? 0) : hits,
        maneuvers: preview ? (preview.maneuvers ?? 0) : MOVE_BUDGET - moves,
    });
    const statRows: { label: string; value: string }[] = [
        { label: 'Урон', value: String(stats.damage) },
        { label: 'Точность', value: `${stats.accuracy} %` },
        { label: 'Выстрелов', value: String(stats.shots) },
        { label: 'Манёвров', value: `${stats.maneuvers} / ${stats.maneuverBudget}` },
    ];

    // Очки лидерборда «Боя дня» — производная метрика (урон + остаток HP +
    // точность), а не сырой HP (решение #422). Формула — в `computeLeaderboardPoints`.
    const points = computeLeaderboardPoints(stats);

    useEffect(() => {
        if (!isGameOver || !seed || !isDailySeed(seed) || submittedRef.current) return;
        if (wasDailyScoreSubmitted(seed)) return;
        submittedRef.current = true;
        submitDailyScore({ seed, points, opponent: BOT_NAME })
            .then(() => markDailyScoreSubmitted(seed))
            .catch((error) => {
                // Ошибку не глотаем: игрок иначе думает, что результат учтён.
                // Ref сбрасываем, чтобы повтор был возможен (напр. после reload).
                console.error('Не удалось записать результат «Боя дня»', error);
                submittedRef.current = false;
            });
    }, [isGameOver, seed, points]);

    // Исход выводится из HP (не из очков): у кого HP больше — тот победил.
    const battleOutcome = deriveOutcome(playerHp, enemyHp);
    const winnerText =
        battleOutcome === 'victory'
            ? 'Победа!'
            : battleOutcome === 'defeat'
              ? 'Поражение'
              : 'Ничья';
    // Исход задаёт тему диалога (token-spec §6): победа красит акцент в зелёный,
    // поражение — в danger. Заголовок читает --accent, поэтому меняется без правки
    // Dialog/Panel — переключение темы на предке через ThemeScope. Ничья нейтральна.
    const outcome: TOutcome | undefined = battleOutcome === 'draw' ? undefined : battleOutcome;
    const isDaily = Boolean(seed && isDailySeed(seed));
    // В режиме `preview` (витрина) стор в покое не гарантирован — если игрок
    // сыграл бой и затем открыл /design-system в той же сессии, battleSeed и
    // друзья ещё заполнены. Статичный срез должен быть детерминирован, поэтому
    // все привязанные к бою ветки гасим явно, а не полагаемся на пустой стор.
    const showBattleBound = !preview;

    return (
        <ThemeScope outcome={outcome} className="contents">
            <Dialog
                open={open}
                variant={dialogVariant}
                className="text-center"
                aria-labelledby={titleId}
            >
                {/* Fluid-размер вместо фиксированного text-h1 (40px): длинное русское
                    слово «ПОРАЖЕНИЕ» одним неразрывным токеном при 40px шире контейнера
                    диалога на узком телефоне (390px) — переноситься ему негде, и он даёт
                    горизонтальный скролл (в боевой модалке тоже, не только на витрине).
                    clamp сжимает заголовок до влезающего на мобиле и держит 40px на
                    десктопе (mobile-first, как fluid --text-display). */}
                <h2
                    id={titleId}
                    className="font-display text-[clamp(1.75rem,7vw,2.5rem)] leading-[1.05] text-[var(--accent)] uppercase [text-shadow:var(--glow-text)]"
                >
                    {winnerText}
                </h2>
                {/* Статистика боя — четыре строки space-between, значения
                    tabular-nums (handoff «Game over»): Урон, Точность %,
                    Выстрелов, Манёвров X / 4. «Ходов N» из старого макета неверно:
                    бюджет манёвра — 4 хода на матч (GDD §2.3). */}
                <dl className="font-ui text-body mt-4 flex flex-col gap-1.5 text-left text-text-muted">
                    {statRows.map(({ label, value }) => (
                        <div key={label} className="flex items-baseline justify-between gap-4">
                            <dt className="uppercase tracking-[0.08em]">{label}</dt>
                            <dd className="tabular-nums text-text">{value}</dd>
                        </div>
                    ))}
                </dl>
                {showBattleBound && isDaily && seed ? (
                    <div className="mt-2">
                        <p className="font-ui text-label text-text-muted uppercase tracking-[0.12em]">
                            Бой дня пройден
                        </p>
                        <ShareDailyResultButton points={points} seed={seed} />
                    </div>
                ) : null}
                {showBattleBound && battleSeed !== null && battleField !== null ? (
                    <ShareReplayButton
                        seed={battleSeed}
                        width={battleField.width}
                        height={battleField.height}
                        moves={replayMoves}
                    />
                ) : null}
                <div className="mt-6 flex flex-wrap justify-center">
                    <Button
                        onClick={() => {
                            resetGame();
                            window.location.reload();
                        }}
                    >
                        Новая игра
                    </Button>
                    <Link href="/" className={buttonClasses('ghost', 'md')}>
                        В меню
                    </Link>
                </div>
            </Dialog>
        </ThemeScope>
    );
}
