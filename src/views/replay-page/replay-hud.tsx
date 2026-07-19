'use client';

import Link from 'next/link';
import { useGameStore } from '@/features/game-engine';
import { useAnimatedValue } from '@/shared/lib/animation';

/**
 * HUD просмотра реплея: счёт из того же store, что и в живом бою, бейдж
 * «Реплей» и выход в собственную игру. Управления нет — бой идёт сам.
 */
export function ReplayHud() {
    const playerPoints = useGameStore((s) => s.playerPoints);
    const enemyPoints = useGameStore((s) => s.enemyPoints);
    const isGameOver = useGameStore((s) => s.isGameOver);

    // Как в GameControls: счёт скачет в сторе, HUD плавно дотягивает число.
    const displayedPlayerPoints = Math.round(useAnimatedValue(playerPoints));
    const displayedEnemyPoints = Math.round(useAnimatedValue(enemyPoints));

    return (
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 sm:gap-4 sm:p-4">
            <div className="font-pixel text-xs text-accent" aria-live="polite">
                {isGameOver ? 'Бой завершён' : '▶ Реплей'}
            </div>

            <div className="flex items-center gap-3 sm:gap-6">
                <div className="flex items-baseline gap-2">
                    <span className="font-pixel text-xs text-muted">Игрок</span>
                    <span className="font-pixel text-xl text-primary">{displayedPlayerPoints}</span>
                </div>
                <span className="font-pixel text-xs text-muted">:</span>
                <div className="flex items-baseline gap-2">
                    <span className="font-pixel text-xl text-danger">{displayedEnemyPoints}</span>
                    <span className="font-pixel text-xs text-muted">Terminator</span>
                </div>
            </div>

            <Link href="/game" className="pixel-border bg-base-100 px-3 py-2 font-pixel text-xs">
                Сыграть самому
            </Link>
        </div>
    );
}
