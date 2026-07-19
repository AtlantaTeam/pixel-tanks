'use client';

import { useEffect, useRef } from 'react';
import { isDailySeed, submitDailyScore } from '@/features/daily-challenge';
import { useGameStore } from '@/features/game-engine';
import { Button, Dialog } from '@/shared/ui';

type TGameOverDialogProps = {
    seed?: string;
};

export function GameOverDialog({ seed }: TGameOverDialogProps = {}) {
    const isGameOver = useGameStore((s) => s.isGameOver);
    const playerPoints = useGameStore((s) => s.playerPoints);
    const enemyPoints = useGameStore((s) => s.enemyPoints);
    const resetGame = useGameStore((s) => s.resetGame);
    const submittedRef = useRef(false);

    useEffect(() => {
        if (!isGameOver || !seed || !isDailySeed(seed) || submittedRef.current) return;
        submittedRef.current = true;
        submitDailyScore({ seed, points: Math.max(0, playerPoints), opponent: 'Terminator' }).catch(
            () => {
                submittedRef.current = false;
            },
        );
    }, [isGameOver, seed, playerPoints]);

    const winnerText =
        playerPoints > enemyPoints ? 'Победа!' : playerPoints < enemyPoints ? 'Поражение' : 'Ничья';

    return (
        <Dialog open={isGameOver} className="text-center">
            <h2 className="font-pixel text-xl text-primary">{winnerText}</h2>
            <p className="mt-4 text-muted">
                Счёт: {playerPoints} — {enemyPoints}
            </p>
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
