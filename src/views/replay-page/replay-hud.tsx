'use client';

import Link from 'next/link';
import { useGameStore } from '@/features/game-engine';
import { BOT_NAME } from '@/shared/config';
import { useAnimatedValue } from '@/shared/lib/animation';
import { buttonClasses, Icon } from '@/shared/ui';

/**
 * HUD просмотра реплея: счёт из того же store, что и в живом бою, бейдж
 * «Реплей» и выход в собственную игру. Управления нет — бой идёт сам.
 */
export function ReplayHud() {
    const playerHp = useGameStore((s) => s.hp.player);
    const enemyHp = useGameStore((s) => s.hp.enemy);
    const isGameOver = useGameStore((s) => s.isGameOver);

    // Как в GameControls: HP скачет в сторе, HUD плавно дотягивает число.
    const displayedPlayerHp = Math.round(useAnimatedValue(playerHp));
    const displayedEnemyHp = Math.round(useAnimatedValue(enemyHp));

    return (
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 sm:gap-4 sm:p-4">
            <div className="flex items-center gap-1 font-ui text-xs text-accent" aria-live="polite">
                {isGameOver ? (
                    'Бой завершён'
                ) : (
                    <>
                        <Icon name="play" size={12} />
                        Реплей
                    </>
                )}
            </div>

            <div className="flex items-center gap-3 sm:gap-6">
                <div className="flex items-baseline gap-2">
                    <span className="font-ui text-xs text-text-muted">Игрок</span>
                    <span className="font-ui text-hud text-primary tabular-nums">
                        {displayedPlayerHp}
                    </span>
                </div>
                <span className="font-ui text-xs text-text-muted">:</span>
                <div className="flex items-baseline gap-2">
                    <span className="font-ui text-hud text-danger tabular-nums">
                        {displayedEnemyHp}
                    </span>
                    <span className="font-ui text-xs text-text-muted">{BOT_NAME}</span>
                </div>
            </div>

            <Link href="/game" className={buttonClasses('ghost', 'sm')}>
                Сыграть самому
            </Link>
        </div>
    );
}
