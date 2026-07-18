import { GameCanvas } from '@/features/game-engine';
import { GameControls } from '@/widgets/game-controls';
import { GameOverDialog } from '@/widgets/game-over-dialog';

export function GamePage() {
    return (
        <main className="flex h-dvh flex-col">
            <div className="relative flex-1 overflow-hidden">
                <GameCanvas />
            </div>
            <div className="border-t border-base-300 bg-base-200">
                <GameControls />
            </div>
            <GameOverDialog />
        </main>
    );
}
