'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { isDailySeed, ShareDailyResultButton, submitDailyScore } from '@/features/daily-challenge';
import { useGameStore } from '@/features/game-engine';
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
     *  считается открытым, а очки берутся отсюда, а не из стора. */
    preview?: { playerPoints: number; enemyPoints: number };
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
    const livePlayerPoints = useGameStore((s) => s.playerPoints);
    const liveEnemyPoints = useGameStore((s) => s.enemyPoints);
    const finalPlayerPoints = useGameStore((s) => s.finalPlayerPoints);
    const finalEnemyPoints = useGameStore((s) => s.finalEnemyPoints);
    // Снимок фиксируется один раз на переходе isGameOver false→true
    // (useGameStore.setGameOver) — пока бой идёт, снимка нет, и заголовок
    // читает живые очки (#337). В режиме `preview` (витрина) очки заданы пропом,
    // а стор не читаем и не трогаем.
    const open = preview ? true : isGameOver;
    const playerPoints = preview ? preview.playerPoints : (finalPlayerPoints ?? livePlayerPoints);
    const enemyPoints = preview ? preview.enemyPoints : (finalEnemyPoints ?? liveEnemyPoints);
    const battleSeed = useGameStore((s) => s.battleSeed);
    const battleField = useGameStore((s) => s.battleField);
    const replayMoves = useGameStore((s) => s.replayMoves);
    const resetGame = useGameStore((s) => s.resetGame);
    const submittedRef = useRef(false);

    const points = Math.max(0, playerPoints);

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

    const winnerText =
        playerPoints > enemyPoints ? 'Победа!' : playerPoints < enemyPoints ? 'Поражение' : 'Ничья';
    // Исход задаёт тему диалога (token-spec §6): победа красит акцент в зелёный,
    // поражение — в danger. Заголовок читает --accent, поэтому меняется без правки
    // Dialog/Panel — переключение темы на предке через ThemeScope. Ничья нейтральна.
    const outcome: TOutcome | undefined =
        playerPoints > enemyPoints ? 'victory' : playerPoints < enemyPoints ? 'defeat' : undefined;
    const isDaily = Boolean(seed && isDailySeed(seed));

    return (
        <ThemeScope outcome={outcome} className="contents">
            <Dialog
                open={open}
                variant={dialogVariant}
                className="text-center"
                aria-labelledby={titleId}
            >
                <h2
                    id={titleId}
                    className="font-display text-h1 text-[var(--accent)] uppercase [text-shadow:var(--glow-text)]"
                >
                    {winnerText}
                </h2>
                <p className="font-ui text-body mt-4 text-text-muted">
                    Счёт: {playerPoints} — {enemyPoints}
                </p>
                {isDaily && seed ? (
                    <div className="mt-2">
                        <p className="font-ui text-label text-text-muted uppercase tracking-[0.12em]">
                            Бой дня пройден
                        </p>
                        <ShareDailyResultButton points={points} seed={seed} />
                    </div>
                ) : null}
                {battleSeed !== null && battleField !== null ? (
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
