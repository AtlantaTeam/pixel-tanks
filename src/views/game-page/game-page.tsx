import Link from 'next/link';
import { GameCanvas } from '@/features/game-engine';
import { SceneMusic } from '@/shared/lib/audio';
import { GameControls } from '@/widgets/game-controls';
import { GameOverDialog } from '@/widgets/game-over-dialog';

type TGamePageProps = {
    seed?: string;
};

export function GamePage({ seed }: TGamePageProps = {}) {
    return (
        <main className="safe-area-inset flex h-dvh flex-col overflow-hidden">
            <SceneMusic track="battle" />
            <div className="relative flex-1 overflow-hidden">
                <GameCanvas seed={seed} />
            </div>
            <div data-testid="game-hud" className="border-t border-border bg-panel">
                <GameControls />
            </div>
            <GameOverDialog seed={seed} />
            <Link
                href="/design-system"
                aria-label="Витрина компонентов"
                style={{
                    top: 'max(1rem, env(safe-area-inset-top))',
                    right: 'max(1rem, env(safe-area-inset-right))',
                }}
                className="fixed min-h-11 min-w-11 flex items-center justify-center rounded-sm bg-panel-raised text-text-muted opacity-50 transition-all hover:opacity-100 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
            >
                ◆
            </Link>
        </main>
    );
}
