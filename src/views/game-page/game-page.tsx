import { GameCanvas } from '@/features/game-engine';
import { GameControls } from '@/widgets/game-controls';
import { GameOverDialog } from '@/widgets/game-over-dialog';

type TGamePageProps = {
    seed?: string;
};

export function GamePage({ seed }: TGamePageProps = {}) {
    return (
        <main className="flex h-dvh flex-col">
            <div className="relative flex-1 overflow-hidden">
                <GameCanvas seed={seed} />
            </div>
            <div className="border-t border-base-300 bg-base-200">
                <GameControls />
            </div>
            <GameOverDialog />
        </main>
    );
}
