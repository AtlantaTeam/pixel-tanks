'use client';

import { useState } from 'react';
import { GameCanvas, useGameStore } from '@/features/game-engine';
import { SceneMusic } from '@/shared/lib/audio';
import { GameControls } from '@/widgets/game-controls';
import { GameOverDialog } from '@/widgets/game-over-dialog';
import { PauseOverlay } from '@/widgets/pause-overlay';
import { TopHud } from '@/widgets/top-hud';

type TGamePageProps = {
    seed?: string;
};

export function GamePage({ seed }: TGamePageProps = {}) {
    const [isPaused, setIsPaused] = useState(false);
    const resetGame = useGameStore((s) => s.resetGame);

    return (
        <main className="safe-area-inset flex h-dvh flex-col overflow-hidden">
            <SceneMusic track="battle" />
            <div className="relative flex-1 overflow-hidden">
                <GameCanvas seed={seed} />
                <TopHud onPauseClick={() => setIsPaused(true)} />
            </div>
            <div data-testid="game-hud" className="border-t border-border bg-panel">
                <GameControls />
            </div>
            <GameOverDialog seed={seed} />
            <PauseOverlay
                open={isPaused}
                onResume={() => setIsPaused(false)}
                onRestart={() => {
                    resetGame();
                    window.location.reload();
                }}
                onExitToMenu={() => {
                    window.location.href = '/';
                }}
            />
        </main>
    );
}
