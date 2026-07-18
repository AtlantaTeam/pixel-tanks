'use client';

import { useGameStore } from '@/features/game-engine';
import { Button, Dialog } from '@/shared/ui';

export function GameOverDialog() {
    const isGameOver = useGameStore((s) => s.isGameOver);
    const playerPoints = useGameStore((s) => s.playerPoints);
    const enemyPoints = useGameStore((s) => s.enemyPoints);
    const resetGame = useGameStore((s) => s.resetGame);

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
