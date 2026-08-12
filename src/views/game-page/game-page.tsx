'use client';

import { useRef, useState } from 'react';
import {
    GameCanvas,
    selectIsBotTurn,
    useGameStore,
    type TGameCanvasHandle,
} from '@/features/game-engine';
import { SceneMusic } from '@/shared/lib/audio';
import { themeAttrs } from '@/shared/lib/theme';
import { GameControls } from '@/widgets/game-controls';
import { GameOverDialog } from '@/widgets/game-over-dialog';
import { PauseOverlay } from '@/widgets/pause-overlay';
import { TopHud } from '@/widgets/top-hud';

type TGamePageProps = {
    seed?: string;
};

/**
 * Арена — `position:absolute; inset:0` во весь экран (handoff «Боевой экран»),
 * верхний HUD и палуба — оверлеи поверх неё, а не соседи во flex-колонке: иначе
 * высота полос ужимала бы канвас на каждом брейкпоинте по-своему (см. докблок
 * `TopHud`). Манёвр/выстрел палубы дёргают движок напрямую через общий ref
 * (`TGameCanvasHandle`) — стор их не хранит.
 */
export function GamePage({ seed }: TGamePageProps = {}) {
    const [isPaused, setIsPaused] = useState(false);
    const resetGame = useGameStore((s) => s.resetGame);
    const gameApiRef = useRef<TGameCanvasHandle>(null);

    // Ход бота (handoff «Ход бота»): весь --accent корня → маджента. Бой
    // окончен — тема нейтральна, финал темизирует себя сам через GameOverDialog.
    // Предикат — общий селектор стора (см. `selectIsBotTurn`).
    const isBotTurn = useGameStore(selectIsBotTurn);

    return (
        <main
            className="safe-area-inset relative h-dvh overflow-hidden"
            {...themeAttrs({ faction: isBotTurn ? 'enemy' : undefined })}
        >
            <SceneMusic track="battle" />
            <GameCanvas ref={gameApiRef} seed={seed} />
            <TopHud onPauseClick={() => setIsPaused(true)} />
            <GameControls gameApiRef={gameApiRef} />
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
