'use client';

import { useEffect, useRef } from 'react';
import { isDailySeed, ShareDailyResultButton, submitDailyScore } from '@/features/daily-challenge';
import { useGameStore } from '@/features/game-engine';
import { Button, Dialog } from '@/shared/ui';

type TGameOverDialogProps = {
    seed?: string;
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

export function GameOverDialog({ seed }: TGameOverDialogProps = {}) {
    const isGameOver = useGameStore((s) => s.isGameOver);
    const playerPoints = useGameStore((s) => s.playerPoints);
    const enemyPoints = useGameStore((s) => s.enemyPoints);
    const resetGame = useGameStore((s) => s.resetGame);
    const submittedRef = useRef(false);

    const points = Math.max(0, playerPoints);

    useEffect(() => {
        if (!isGameOver || !seed || !isDailySeed(seed) || submittedRef.current) return;
        if (wasDailyScoreSubmitted(seed)) return;
        submittedRef.current = true;
        submitDailyScore({ seed, points, opponent: 'Terminator' })
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
    const isDaily = Boolean(seed && isDailySeed(seed));

    return (
        <Dialog open={isGameOver} className="text-center">
            <h2 className="font-pixel text-xl text-primary">{winnerText}</h2>
            <p className="mt-4 text-muted">
                Счёт: {playerPoints} — {enemyPoints}
            </p>
            {isDaily && seed ? (
                <div className="mt-2">
                    <p className="font-pixel text-[10px] text-muted uppercase">Бой дня пройден</p>
                    <ShareDailyResultButton points={points} seed={seed} />
                </div>
            ) : null}
            <div className="mt-6">
                <Button
                    onClick={() => {
                        resetGame();
                        window.location.reload();
                    }}
                >
                    Новая игра
                </Button>
            </div>
        </Dialog>
    );
}
